import type { BusinessCard } from "./types";
import { withCardDefaults } from "./types";

export type ImportMode = "skip" | "replace";

export type ImportResult = {
  added: number;
  replaced: number;
  skipped: number;
  cards: BusinessCard[];
};

function isCardLike(value: unknown): value is BusinessCard {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.frontImage === "string";
}

export function parseBackupJson(raw: string): BusinessCard[] {
  const data = JSON.parse(raw) as unknown;
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { cards?: unknown }).cards)
      ? ((data as { cards: unknown[] }).cards)
      : null;
  if (!list) throw new Error("Backup must be a JSON array of cards (or { cards: [...] }).");
  const cards: BusinessCard[] = [];
  for (const item of list) {
    if (!isCardLike(item)) continue;
    cards.push(
      withCardDefaults({
        id: item.id,
        company: String(item.company ?? ""),
        personName: String(item.personName ?? ""),
        title: String(item.title ?? ""),
        phone: String(item.phone ?? ""),
        email: String(item.email ?? ""),
        website: String(item.website ?? ""),
        address: String(item.address ?? ""),
        notes: String(item.notes ?? ""),
        line: String(item.line ?? ""),
        frontImage: item.frontImage,
        backImage: (item.backImage as string | null) ?? null,
        createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        isSample: Boolean(item.isSample),
        favorite: Boolean(item.favorite),
        lastViewedAt:
          typeof item.lastViewedAt === "number" ? item.lastViewedAt : undefined,
      }),
    );
  }
  return cards;
}

export function mergeImportedCards(
  existing: BusinessCard[],
  incoming: BusinessCard[],
  mode: ImportMode,
): ImportResult {
  const byId = new Map(existing.map((c) => [c.id, c]));
  let added = 0;
  let replaced = 0;
  let skipped = 0;

  for (const card of incoming) {
    if (byId.has(card.id)) {
      if (mode === "replace") {
        byId.set(card.id, card);
        replaced += 1;
      } else {
        skipped += 1;
      }
    } else {
      byId.set(card.id, card);
      added += 1;
    }
  }

  return { added, replaced, skipped, cards: [...byId.values()] };
}

export function downloadBackupJson(cards: BusinessCard[]): void {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    cards,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `folio-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
