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
  /\b(director|manager|partner|owner|founder|co-?founder|engineer|designer|chef|attorney|counsel|photographer|producer|editor|consultant|ceo|cto|cfo|coo|vp|vice[- ]?president|president|principal|associate|importer|creative director|lead|head of)\b/i;
const COMPANY_HINTS =
  /\b(studio|co\.?|company|corp\.?|corporation|llc|inc\.?|ltd\.?|llp|group|partners|agency|labs?|workshop|atelier|kitchen|glass|type|harbor|grove|wines?|law|construction|interiors?|design)\b/i;

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
  // Prefer Title Case / mixed case words without digits.
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
  if (/\b(llc|inc|ltd|corp|co)\b/i.test(line)) score += 6;
  if (/[&+]/.test(line)) score += 2;
  const words = line.split(/\s+/).length;
  if (words >= 1 && words <= 5) score += 2;
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
    .replace(/(?<=\d)[Oo](?=\d)/g, "0")
    .replace(/(?<=\d)[Il|](?=\d)/g, "1")
    .replace(/(?<=\d)[Ss](?=\d)/g, "5")
    .replace(/(?<=\d)[Bb](?=\d)/g, "8");
}

function normalizeEmailNoise(raw: string): string {
  return raw
    .replace(/\s+/g, "")
    .replace(/[@＠]/g, "@")
    .replace(/,/g, ".")
    .replace(/(\w)\s*@\s*(\w)/g, "$1@$2");
}

function parseOcrText(text: string): CardFields {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const fields: CardFields = { ...EMPTY_FIELDS };
  const used = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const email = normalizeEmailNoise(line).match(EMAIL_RE)?.[0];
    if (email && !fields.email) {
      fields.email = email;
      used.add(i);
      continue;
    }
    const phoneMatch = normalizePhoneNoise(line).match(PHONE_RE)?.[0];
    if (
      phoneMatch &&
      !fields.phone &&
      phoneMatch.replace(/\D/g, "").length >= 7 &&
      phoneMatch.replace(/\D/g, "").length <= 15
    ) {
      fields.phone = phoneMatch.trim();
      used.add(i);
      continue;
    }
    const url = line.match(URL_RE)?.[0];
    if (url && !fields.website && !EMAIL_RE.test(url) && /\.[a-z]{2,}/i.test(url)) {
      fields.website = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
      used.add(i);
      continue;
    }
    if (!fields.address && looksLikeAddress(line)) {
      fields.address = line;
      used.add(i);
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

  // Prefer person name that looks like a person; company that looks corporate.
  const person = nameCandidates[0] ?? "";
  if (person) fields.personName = person;

  const company =
    companyCandidates.find((line) => line !== fields.personName && companyScore(line) > 0) ??
    companyCandidates.find((line) => line !== fields.personName) ??
    "";
  if (company) fields.company = company;

  // If we only got one leftover that looks corporate and no person, don't force person.
  if (!fields.personName && nameCandidates.length === 0) {
    // leave empty — manual edit always available
  }

  const assigned = new Set(
    [fields.personName, fields.title, fields.company, fields.address].filter(Boolean),
  );
  const notes = leftover
    .filter((line) => !assigned.has(line))
    .filter((line) => line.length > 2)
    .slice(0, 3)
    .join(" · ");
  if (notes) fields.notes = notes;

  fields.line = guessLineFromText(text);
  return fields;
}

/** Max longest side for OCR canvas — enough for cards, safe on phones. */
const OCR_MAX_SIDE = 1400;

/**
 * Preprocess a card photo for Tesseract: mild upscale, grayscale, contrast
 * stretch, unsharp. Memory-safe (single canvas ≤ OCR_MAX_SIDE).
 */
async function preprocessForOcr(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load image for OCR"));
    el.src = dataUrl;
  });

  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const scale = Math.min(1.35, OCR_MAX_SIDE / Math.max(nw, nh, 1));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return dataUrl;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const gray = new Uint8ClampedArray(w * h);

  // Grayscale + gather percentiles for contrast stretch
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const g = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0;
    gray[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  // Robust stretch using approximate 2nd/98th percentiles via histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  const loTarget = total * 0.02;
  const hiTarget = total * 0.98;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= loTarget) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (total - acc <= hiTarget) {
      // walk until cumulative from top reaches 2%
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
    lo = min;
    hi = max;
  }
  const range = Math.max(1, hi - lo);

  // Contrast-stretch into gray buffer
  for (let i = 0; i < gray.length; i++) {
    const stretched = (((gray[i] - lo) * 255) / range) | 0;
    gray[i] = stretched < 0 ? 0 : stretched > 255 ? 255 : stretched;
  }

  // Mild unsharp: gray + 0.45 * (gray - box-blur(gray))
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

  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const sharp = gray[i] + 0.45 * (gray[i] - blurred[i]);
    const v = sharp < 0 ? 0 : sharp > 255 ? 255 : sharp | 0;
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  // JPEG keeps OCR payload smaller than PNG on phones
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function ocrOnce(
  worker: Awaited<ReturnType<typeof createWorker>>,
  image: string,
  psm: PSM,
): Promise<string> {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
  });
  const {
    data: { text },
  } = await worker.recognize(image);
  return (text ?? "").trim();
}

function scoreOcrText(text: string): number {
  if (!text) return 0;
  let score = Math.min(text.length, 400);
  if (EMAIL_RE.test(text)) score += 80;
  if (PHONE_RE.test(text)) score += 60;
  if (URL_RE.test(text)) score += 40;
  const lines = text.split(/\n/).filter((l) => l.trim().length > 1);
  score += Math.min(lines.length, 12) * 5;
  return score;
}

async function ocrImage(dataUrl: string): Promise<string> {
  let prepared = dataUrl;
  try {
    prepared = await preprocessForOcr(dataUrl);
  } catch {
    prepared = dataUrl;
  }

  const worker = await createWorker("eng", 1, {
    logger: () => undefined,
  });
  try {
    // PSM 6 = assume a single uniform block of text (typical card layout)
    // PSM 4 = single column of variable-size text
    // PSM 11 = sparse text — good when logos break layout
    const passA = await ocrOnce(worker, prepared, PSM.SINGLE_BLOCK);
    let best = passA;
    let bestScore = scoreOcrText(passA);

    if (bestScore < 120) {
      const passB = await ocrOnce(worker, prepared, PSM.SINGLE_COLUMN);
      const scoreB = scoreOcrText(passB);
      if (scoreB > bestScore) {
        best = passB;
        bestScore = scoreB;
      }
    }

    if (bestScore < 100) {
      const passC = await ocrOnce(worker, prepared, PSM.SPARSE_TEXT);
      if (scoreOcrText(passC) > bestScore) {
        best = passC;
      }
    }

    return best;
  } finally {
    await worker.terminate();
  }
}

/**
 * Client-side card reading via Tesseract.js.
 * Best-effort field heuristics; callers always allow manual edit.
 * OCR failure never blocks save — returns ok:false with a friendly error.
 */
export async function extractCardInfo(input: ExtractInput): Promise<ExtractResult> {
  if (!input?.frontImage || !isDataImage(input.frontImage)) {
    return { ok: false, error: "A card photo is required" };
  }
  if (input.frontImage.length > 2_400_000) {
    return { ok: false, error: "That photo is too large" };
  }
  if (
    input.backImage &&
    (!isDataImage(input.backImage) || input.backImage.length > 2_400_000)
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
