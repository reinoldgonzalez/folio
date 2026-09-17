import type { BusinessCard, CardFields } from "./types";
import {
  normalizeEmail,
  normalizePersonKey,
  normalizePhone,
} from "./types";

export type DuplicateMatch = {
  card: BusinessCard;
  reasons: ("phone" | "email" | "company+person")[];
};

export function findDuplicates(
  cards: BusinessCard[],
  candidate: CardFields,
  excludeId?: string | null,
): DuplicateMatch[] {
  const phone = normalizePhone(candidate.phone);
  const email = normalizeEmail(candidate.email);
  const company = normalizePersonKey(candidate.company);
  const person = normalizePersonKey(candidate.personName);

  const matches: DuplicateMatch[] = [];

  for (const card of cards) {
    if (excludeId && card.id === excludeId) continue;
    const reasons: DuplicateMatch["reasons"] = [];

    if (phone.length >= 7 && normalizePhone(card.phone) === phone) {
      reasons.push("phone");
    }
    if (email && normalizeEmail(card.email) === email) {
      reasons.push("email");
    }
    if (
      company &&
      person &&
      normalizePersonKey(card.company) === company &&
      normalizePersonKey(card.personName) === person
    ) {
      reasons.push("company+person");
    }

    if (reasons.length > 0) {
      matches.push({ card, reasons });
    }
  }

  return matches;
}

/** Merge new fields into existing; keep id/images unless new images provided. */
export function mergeCardFields(
  existing: BusinessCard,
  incoming: CardFields & { frontImage?: string | null; backImage?: string | null },
): Omit<BusinessCard, "id" | "createdAt"> {
  const pick = (next: string, prev: string) => (next.trim() ? next : prev);

  const frontImage =
    incoming.frontImage && incoming.frontImage.trim()
      ? incoming.frontImage
      : existing.frontImage;
  const backImage =
    incoming.backImage === undefined
      ? existing.backImage
      : incoming.backImage && incoming.backImage.trim()
        ? incoming.backImage
        : existing.backImage;

  return {
    company: pick(incoming.company, existing.company),
    personName: pick(incoming.personName, existing.personName),
    title: pick(incoming.title, existing.title),
    phone: pick(incoming.phone, existing.phone),
    email: pick(incoming.email, existing.email),
    website: pick(incoming.website, existing.website),
    address: pick(incoming.address, existing.address),
    notes: pick(incoming.notes, existing.notes),
    line: pick(incoming.line, existing.line),
    frontImage,
    backImage,
    isSample: existing.isSample,
    favorite: existing.favorite,
    lastViewedAt: existing.lastViewedAt,
  };
}
