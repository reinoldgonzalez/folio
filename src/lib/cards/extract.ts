import { createWorker } from "tesseract.js";
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

function parseOcrText(text: string): CardFields {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const fields: CardFields = { ...EMPTY_FIELDS };
  const used = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const email = line.match(EMAIL_RE)?.[0];
    if (email && !fields.email) {
      fields.email = email;
      used.add(i);
      continue;
    }
    const phoneMatch = line.match(PHONE_RE)?.[0];
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

async function ocrImage(dataUrl: string): Promise<string> {
  const worker = await createWorker("eng", 1, {
    logger: () => undefined,
  });
  try {
    const {
      data: { text },
    } = await worker.recognize(dataUrl);
    return text ?? "";
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
