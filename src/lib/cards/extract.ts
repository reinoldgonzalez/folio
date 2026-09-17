import { createWorker, PSM } from "tesseract.js";
import {
  EMPTY_FIELDS,
  guessLineFromText,
  suggestLinesFromText,
  type CardFields,
} from "./types";

type ExtractInput = {
  frontImage: string;
  backImage: string | null;
};

export type ExtractResult =
  | { ok: true; fields: CardFields; suggestedLines: string[] }
  | { ok: false; error: string; suggestedLines?: string[] };

function isDataImage(value: string): boolean {
  return /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value);
}

/** Stronger contact regexes — tolerate OCR noise and separators. */
const EMAIL_RE =
  /[A-Z0-9][A-Z0-9._%+-]*@[A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,24}/i;
const PHONE_RE =
  /(?:(?:\+|00)\d{1,3}[\s./-]?)?(?:\(?\d{2,4}\)?[\s./-]?)?\d{2,4}[\s./-]?\d{2,4}(?:[\s./-]?\d{2,4})?\b/;
const URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s]*)?/i;
const TITLE_HINTS =
  /\b(director|manager|partner|owner|founder|co-?founder|engineer|designer|chef|attorney|counsel|photographer|producer|editor|consultant|ceo|cto|cfo|coo|vp|vice[- ]?president|president|principal|associate|importer|creative director|lead|head of|florist|contractor)\b/i;
const COMPANY_HINTS =
  /\b(studio|co\.?|company|corp\.?|corporation|llc|inc\.?|ltd\.?|llp|group|partners|agency|labs?|workshop|atelier|kitchen|glass|type|harbor|grove|wines?|law|construction|interiors?|design|botanica|build)\b/i;

function looksLikeAddress(line: string): boolean {
  return (
    /\d/.test(line) &&
    /\b(st|street|ave|avenue|rd|road|blvd|suite|ste|floor|fl|#|apt|unit|dr|drive|way|ln|lane|ct|court|pl|place|pobox|po box|ca|ny|tx|wa|or|co|il|ma|fl|sf|nyc|zip)\b/i.test(
      line,
    )
  );
}

function looksLikePersonName(line: string): boolean {
  if (line.length < 3 || line.length > 48) return false;
  if (TITLE_HINTS.test(line) || looksLikeAddress(line) || URL_RE.test(line)) return false;
  if (COMPANY_HINTS.test(line)) return false;
  if (line === line.toUpperCase() && line.length > 6) return false;
  if (/\d/.test(line)) return false;
  return /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’ -]+$/.test(line);
}

function looksLikeCompany(line: string): boolean {
  if (line.length < 2 || line.length > 64) return false;
  if (looksLikeAddress(line) || URL_RE.test(line) || EMAIL_RE.test(line)) return false;
  if (TITLE_HINTS.test(line) && !COMPANY_HINTS.test(line)) return false;
  return true;
}

function companyScore(line: string): number {
  let score = 0;
  if (COMPANY_HINTS.test(line)) score += 8;
  if (line === line.toUpperCase() && /[A-Z]/.test(line)) score += 5;
  if (line === line.toUpperCase() && line.length >= 6) score += 4;
  if (/\b(llc|inc|ltd|corp|co)\b/i.test(line)) score += 6;
  if (/[&+]/.test(line)) score += 2;
  const words = line.split(/\s+/).length;
  if (words >= 1 && words <= 5) score += 2;
  // Short legal tokens ("LAW", "INC") lose to real brand lines
  if (COMPANY_HINTS.test(line) && words === 1 && line.length <= 4) score -= 10;
  if (looksLikePersonName(line) && !COMPANY_HINTS.test(line)) score -= 4;
  return score;
}

function personScore(line: string): number {
  let score = 0;
  const words = line.split(/\s+/);
  if (words.length >= 2 && words.length <= 4) score += 6;
  if (words.every((w) => /^[A-ZÀ-ÖØ-Þ]/.test(w))) score += 4;
  if (looksLikePersonName(line)) score += 3;
  if (COMPANY_HINTS.test(line)) score -= 6;
  return score;
}

/** Fix common OCR swaps in phone-like tokens (O→0, I/l→1, S→5, B→8). */
function normalizePhoneNoise(raw: string): string {
  return raw
    .replace(/(?<=[\d\s./()-])[Oo](?=[\d\s./()-]|$)/g, "0")
    .replace(/(?<=[\d\s./()-])[Il|](?=[\d\s./()-]|$)/g, "1")
    .replace(/(?<=[\d\s./()-])[Ss](?=[\d\s./()-]|$)/g, "5")
    .replace(/(?<=[\d\s./()-])[Bb](?=[\d\s./()-]|$)/g, "8")
    .replace(/^[Oo](?=\d)/g, "0")
    .replace(/(?<=\d)[Oo]$/g, "0");
}

/**
 * Collapse spaces on a single token/line, normalize @, and fix O→0 only when
 * the O sits next to a digit in the domain (do not smash ".studio" → ".studi0").
 */
function normalizeEmailNoise(raw: string): string {
  let s = raw
    .replace(/\s+/g, "")
    .replace(/[@＠]/g, "@")
    .replace(/,/g, ".")
    .replace(/(\w)[@＠](\w)/g, "$1@$2");

  const at = s.indexOf("@");
  if (at >= 0) {
    const local = s.slice(0, at);
    let domain = s.slice(at + 1);
    domain = domain.replace(/(?<=\d)O/g, "0").replace(/O(?=\d)/g, "0");
    domain = domain.replace(/\.+$/g, "");
    s = `${local}@${domain}`;
  }
  return s;
}

function isPlausibleEmail(email: string): boolean {
  if (!email || email.length > 72) return false;
  const at = email.indexOf("@");
  if (at < 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || domain.length > 64) return false;
  if (local.length < 1 || domain.length < 3) return false;
  // Reject concatenation artifacts (phone digits glued into local part)
  if (/\d{5,}/.test(local)) return false;
  if ((domain.match(/\./g) || []).length > 3) return false;
  // Domain labels should look like DNS, not an address line
  if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/.test(domain)) return false;
  return EMAIL_RE.test(email);
}

/** Pull a likely email from a line or short snippet (never whole-card concat). */
function findEmail(text: string): string | undefined {
  // 1) Line-by-line (preferred)
  for (const line of text.split(/\r?\n/)) {
    const compacted = normalizeEmailNoise(line);
    const match = compacted.match(EMAIL_RE)?.[0];
    if (match && isPlausibleEmail(match)) return match;
  }

  // 2) Explicit local @ domain with optional OCR spaces
  const spaced = text.match(
    /[A-Z0-9][A-Z0-9._%+-]*\s*[@＠]\s*[A-Z0-9][A-Z0-9.-]*\s*\.\s*[A-Z]{2,24}/i,
  )?.[0];
  if (spaced) {
    const match = normalizeEmailNoise(spaced).match(EMAIL_RE)?.[0];
    if (match && isPlausibleEmail(match)) return match;
  }

  // 3) Last resort: compact the whole string but require plausibility
  const compacted = normalizeEmailNoise(text);
  const all = compacted.match(
    new RegExp(EMAIL_RE.source, "gi"),
  );
  if (all) {
    for (const candidate of all) {
      if (isPlausibleEmail(candidate)) return candidate;
    }
  }
  return undefined;
}

function findPhone(text: string): string | undefined {
  const cleaned = normalizePhoneNoise(text);
  const match = cleaned.match(PHONE_RE)?.[0];
  if (!match) return undefined;
  const digits = match.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return undefined;
  // Reject years / zip-like short runs that slipped through
  if (digits.length === 4) return undefined;
  return match.trim();
}

function findUrl(text: string): string | undefined {
  const match = text.match(URL_RE)?.[0];
  if (!match) return undefined;
  if (EMAIL_RE.test(match)) return undefined;
  if (!/\.[a-z]{2,}/i.test(match)) return undefined;
  // Prefer bare host without trailing punctuation OCR junk
  return match
    .replace(/^https?:\/\//i, "")
    .replace(/[),.;:]+$/g, "")
    .replace(/\/$/, "");
}

export function parseOcrText(text: string): CardFields {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const fields: CardFields = { ...EMPTY_FIELDS };
  const used = new Set<number>();

  // Prefer per-line contact extraction; findEmail already scans lines safely.
  const wholeEmail = findEmail(text);
  if (wholeEmail) fields.email = wholeEmail;
  const wholePhone = findPhone(normalizePhoneNoise(text.replace(/\n/g, " ")));
  if (wholePhone) fields.phone = wholePhone;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const email = findEmail(line);
    if (email && !fields.email) {
      fields.email = email;
      used.add(i);
      continue;
    }
    if (email && fields.email && email === fields.email) {
      used.add(i);
      continue;
    }
    const phoneMatch = findPhone(line);
    if (phoneMatch && !fields.phone) {
      fields.phone = phoneMatch;
      used.add(i);
      continue;
    }
    if (phoneMatch && fields.phone && phoneMatch === fields.phone) {
      used.add(i);
      continue;
    }
    const url = findUrl(line);
    const emailDomain = fields.email?.split("@")[1]?.toLowerCase();
    if (
      url &&
      !fields.website &&
      (!emailDomain || url.toLowerCase() !== emailDomain)
    ) {
      fields.website = url;
      used.add(i);
      continue;
    }
    if (!fields.address && looksLikeAddress(line)) {
      fields.address = line;
      used.add(i);
    }
  }

  // Website from whole text if still missing (skip email domains)
  if (!fields.website) {
    const url = findUrl(text.replace(/\n/g, " "));
    const emailDomain = fields.email?.split("@")[1]?.toLowerCase();
    if (
      url &&
      (!emailDomain || url.toLowerCase() !== emailDomain) &&
      (!fields.email || !fields.email.toLowerCase().includes(url.toLowerCase()))
    ) {
      fields.website = url;
    }
  }

  const leftover = lines.filter((_, i) => !used.has(i));

  for (const line of leftover) {
    if (!fields.title && TITLE_HINTS.test(line) && line.length < 70) {
      fields.title = line;
      break;
    }
  }

  const nameCandidates = leftover
    .filter((line) => line !== fields.title && looksLikePersonName(line))
    .sort((a, b) => personScore(b) - personScore(a));

  const companyCandidates = leftover
    .filter((line) => line !== fields.title && looksLikeCompany(line))
    .sort((a, b) => companyScore(b) - companyScore(a));

  const person = nameCandidates[0] ?? "";
  if (person) fields.personName = person;

  const company =
    companyCandidates.find((line) => line !== fields.personName && companyScore(line) > 0) ??
    companyCandidates.find((line) => line !== fields.personName) ??
    "";
  if (company) fields.company = company;

  const assigned = new Set(
    [fields.personName, fields.title, fields.company, fields.address].filter(Boolean),
  );
  const notes = leftover
    .filter((line) => !assigned.has(line))
    .filter((line) => line.length > 2)
    .filter((line) => {
      // Drop lines already captured as contacts
      if (fields.email && line.includes(fields.email)) return false;
      if (fields.phone && line.includes(fields.phone)) return false;
      if (fields.website && line.toLowerCase().includes(fields.website.toLowerCase())) return false;
      const emailDomain = fields.email?.split("@")[1];
      if (emailDomain && line.toLowerCase() === emailDomain.toLowerCase()) return false;
      return true;
    })
    .slice(0, 3)
    .join(" · ");
  if (notes) fields.notes = notes;

  fields.line = guessLineFromText(text);
  return fields;
}

/** Target short side for OCR; upscale small crops so glyphs are readable. */
const OCR_SHORT_SIDE = 1400;
/** Hard cap on longest side — keeps phone RAM in check. */
const OCR_MAX_SIDE = 1800;

function ocrScale(nw: number, nh: number): number {
  const short = Math.min(nw, nh);
  const long = Math.max(nw, nh);
  if (long <= 0 || short <= 0) return 1;
  if (long > OCR_MAX_SIDE) {
    return OCR_MAX_SIDE / long;
  }
  if (short < OCR_SHORT_SIDE) {
    return Math.min(OCR_SHORT_SIDE / short, OCR_MAX_SIDE / long);
  }
  return 1;
}

type PreprocessMode = "mild" | "stretch" | "invert";

/**
 * Preprocess a card photo for Tesseract: upscale short side, grayscale,
 * gentle contrast stretch, mild unsharp. Optional invert for light-on-dark.
 * Memory-safe (single canvas ≤ OCR_MAX_SIDE).
 */
async function preprocessForOcr(
  dataUrl: string,
  mode: PreprocessMode = "stretch",
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load image for OCR"));
    el.src = dataUrl;
  });

  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const scale = ocrScale(nw, nh);
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return dataUrl;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const gray = new Uint8ClampedArray(w * h);

  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0;
  }

  // Optional gentle percentile stretch (1%/99%). "mild" skips this — better for
  // already high-contrast or delicately typeset cards that wash out when stretched.
  if (mode !== "mild") {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let lo = 0;
    let hi = 255;
    let acc = 0;
    const loTarget = total * 0.01;
    const hiTarget = total * 0.99;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= loTarget) {
        lo = v;
        break;
      }
    }
    acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= hiTarget) {
        hi = v;
        break;
      }
    }
    if (hi <= lo + 8) {
      lo = 0;
      hi = 255;
    }
    const range = Math.max(1, hi - lo);

    // Map into 10–245 to avoid crushing antialiased glyphs to pure B/W
    for (let i = 0; i < gray.length; i++) {
      const stretched = (10 + (((gray[i] - lo) * 235) / range)) | 0;
      gray[i] = stretched < 0 ? 0 : stretched > 255 ? 255 : stretched;
    }
  }

  // Mild unsharp
  const blurred = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += gray[yy * w + xx];
          n++;
        }
      }
      blurred[y * w + x] = (sum / n) | 0;
    }
  }

  const invert = mode === "invert";
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    let sharp = gray[i] + 0.4 * (gray[i] - blurred[i]);
    if (sharp < 0) sharp = 0;
    if (sharp > 255) sharp = 255;
    let v = sharp | 0;
    if (invert) v = 255 - v;
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}

type OcrPass = { text: string; confidence: number };

async function ocrOnce(
  worker: Awaited<ReturnType<typeof createWorker>>,
  image: string,
  psm: PSM,
): Promise<OcrPass> {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
  });
  const {
    data: { text, confidence },
  } = await worker.recognize(image);
  return { text: (text ?? "").trim(), confidence: confidence ?? 0 };
}

function scoreOcrText(text: string, confidence = 0): number {
  if (!text) return 0;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  const alnum = letters + digits;
  if (alnum < 6) return 0;

  // Prefer real characters over raw length (avoids picking long glyph noise)
  let score = Math.min(alnum, 280);
  score += Math.round((confidence || 0) * 0.6);

  if (findEmail(text)) score += 120;
  if (findPhone(text)) score += 100;
  if (findUrl(text)) score += 55;

  const lines = text.split(/\n/).filter((l) => /[A-Za-z]{2,}/.test(l));
  score += Math.min(lines.length, 14) * 8;

  const ratio = alnum / Math.max(text.length, 1);
  if (ratio < 0.35) score -= 160;
  else if (ratio < 0.5) score -= 70;

  const junk = (text.match(/[^A-Za-z0-9\s@.,+\-()/:#']/g) || []).length;
  if (junk > text.length * 0.12) score -= 90;

  return score;
}

const PRIMARY_PSMS: PSM[] = [
  PSM.SPARSE_TEXT,
  PSM.SINGLE_BLOCK,
  PSM.AUTO,
  PSM.SINGLE_COLUMN,
];

const INVERT_PSMS: PSM[] = [PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK];

function hasUsefulContacts(text: string): boolean {
  return Boolean(findEmail(text) || findPhone(text) || findUrl(text));
}

async function ocrImage(dataUrl: string): Promise<string> {
  let mild = dataUrl;
  try {
    mild = await preprocessForOcr(dataUrl, "mild");
  } catch {
    mild = dataUrl;
  }

  const worker = await createWorker("eng", 1, {
    logger: () => undefined,
  });
  try {
    let best = "";
    let bestScore = -1;

    const consider = async (image: string, psms: PSM[]) => {
      for (const psm of psms) {
        const pass = await ocrOnce(worker, image, psm);
        const score = scoreOcrText(pass.text, pass.confidence);
        if (score > bestScore) {
          best = pass.text;
          bestScore = score;
        }
      }
    };

    // Start with mild preprocess — preserves delicate / already-contrasty cards
    await consider(mild, PRIMARY_PSMS);

    // Escalate only when contacts are missing — saves phone RAM/CPU
    if (!hasUsefulContacts(best) || bestScore < 160) {
      try {
        const stretched = await preprocessForOcr(dataUrl, "stretch");
        await consider(stretched, [PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK, PSM.AUTO]);
      } catch {
        // keep mild best
      }
    }
    if (!hasUsefulContacts(best) || bestScore < 160) {
      try {
        const inverted = await preprocessForOcr(dataUrl, "invert");
        await consider(inverted, INVERT_PSMS);
      } catch {
        // keep current best
      }
    }

    return best;
  } finally {
    await worker.terminate();
  }
}

/** Reject absurd payloads; ~8MB data-URL ≈ ~6MB binary — still phone-safe after preprocess. */
const MAX_DATA_URL_CHARS = 8_000_000;

/**
 * Client-side card reading via Tesseract.js.
 * Best-effort field heuristics; callers always allow manual edit.
 * OCR failure never blocks save — returns ok:false with a friendly error.
 */
export async function extractCardInfo(input: ExtractInput): Promise<ExtractResult> {
  if (!input?.frontImage || !isDataImage(input.frontImage)) {
    return { ok: false, error: "A card photo is required" };
  }
  if (input.frontImage.length > MAX_DATA_URL_CHARS) {
    return { ok: false, error: "That photo is too large" };
  }
  if (
    input.backImage &&
    (!isDataImage(input.backImage) || input.backImage.length > MAX_DATA_URL_CHARS)
  ) {
    return { ok: false, error: "The back photo could not be read" };
  }

  try {
    const parts = [await ocrImage(input.frontImage)];
    if (input.backImage) {
      parts.push(await ocrImage(input.backImage));
    }
    const text = parts.join("\n");
    if (!text.trim()) {
      return {
        ok: false,
        error: "Could not read any text. You can fill in the details yourself.",
        suggestedLines: [...suggestLinesFromText("")],
      };
    }
    const fields = parseOcrText(text);
    const hasAnything = Boolean(
      fields.personName ||
        fields.company ||
        fields.email ||
        fields.phone ||
        fields.website ||
        fields.title ||
        fields.address ||
        fields.notes,
    );
    if (!hasAnything) {
      return {
        ok: false,
        error: "Could not read any text. You can fill in the details yourself.",
        suggestedLines: suggestLinesFromText(text),
        // Still surface raw-ish hints via suggested lines; fields stay empty in caller
      };
    }
    return {
      ok: true,
      fields,
      suggestedLines: suggestLinesFromText(
        [text, fields.company, fields.title, fields.notes, fields.line].join(" "),
      ),
    };
  } catch {
    return {
      ok: false,
      error: "Could not read the card automatically. You can fill in the details yourself.",
    };
  }
}
