import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  mergeImportedCards,
  parseBackupJson,
  type ImportMode,
} from "./backup";
import { mergeCardFields } from "./duplicates";
import type { BusinessCard, CardFields } from "./types";
import { normalizeLine, withCardDefaults } from "./types";

type CaptureMode = { kind: "closed" } | { kind: "create" } | { kind: "edit"; id: string };

type Persisted = {
  cards?: BusinessCard[];
  activeId?: string | null;
  pinnedLines?: string[];
};

type CardState = {
  cards: BusinessCard[];
  query: string;
  lineFilter: string;
  activeId: string | null;
  capture: CaptureMode;
  pinnedLines: string[];
  setQuery: (query: string) => void;
  setLineFilter: (line: string) => void;
  setActiveId: (id: string | null) => void;
  openCreate: () => void;
  openEdit: (id: string) => void;
  closeCapture: () => void;
  addCard: (input: CardFields & { frontImage: string; backImage: string | null }) => string;
  updateCard: (
    id: string,
    patch: Partial<Omit<BusinessCard, "id" | "createdAt">>,
    options?: { keepCaptureOpen?: boolean },
  ) => void;
  mergeIntoCard: (
    id: string,
    input: CardFields & { frontImage?: string | null; backImage?: string | null },
  ) => void;
  removeCard: (id: string) => void;
  toggleFavorite: (id: string) => void;
  togglePinnedLine: (line: string) => void;
  importBackup: (raw: string, mode: ImportMode) => { added: number; replaced: number; skipped: number };
  replaceAllCards: (cards: BusinessCard[]) => void;
};

function newId(): string {
  return `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useCardStore = create<CardState>()(
  persist(
    (set, get) => ({
      cards: [],
      query: "",
      lineFilter: "",
      activeId: null,
      capture: { kind: "closed" },
      pinnedLines: [],
      setQuery: (query) => set({ query }),
      setLineFilter: (lineFilter) => set({ lineFilter }),
      setActiveId: (activeId) => {
        if (!activeId) {
          set({ activeId });
          return;
        }
        const now = Date.now();
        set({
          activeId,
          cards: get().cards.map((card) =>
            card.id === activeId ? { ...card, lastViewedAt: now } : card,
          ),
        });
      },
      openCreate: () => set({ capture: { kind: "create" } }),
      openEdit: (id) => set({ capture: { kind: "edit", id } }),
      closeCapture: () => set({ capture: { kind: "closed" } }),
      addCard: (input) => {
        const id = newId();
        const now = Date.now();
        const card: BusinessCard = {
          ...input,
          id,
          createdAt: now,
          lastViewedAt: now,
          favorite: false,
        };
        set({ cards: [...get().cards, card], activeId: id, capture: { kind: "closed" } });
        return id;
      },
      updateCard: (id, patch, options) => {
        set({
          cards: get().cards.map((card) => (card.id === id ? { ...card, ...patch } : card)),
          ...(options?.keepCaptureOpen ? {} : { capture: { kind: "closed" as const } }),
        });
      },
      mergeIntoCard: (id, input) => {
        const existing = get().cards.find((c) => c.id === id);
        if (!existing) return;
        const merged = mergeCardFields(existing, input);
        set({
          cards: get().cards.map((card) =>
            card.id === id ? { ...card, ...merged, lastViewedAt: Date.now() } : card,
          ),
          activeId: id,
          capture: { kind: "closed" },
        });
      },
      removeCard: (id) => {
        const cards = get().cards.filter((card) => card.id !== id);
        const activeId = get().activeId === id ? (cards[0]?.id ?? null) : get().activeId;
        set({ cards, activeId });
      },
      toggleFavorite: (id) => {
        set({
          cards: get().cards.map((card) =>
            card.id === id ? { ...card, favorite: !card.favorite } : card,
          ),
        });
      },
      togglePinnedLine: (line) => {
        const normalized = normalizeLine(line);
        if (!normalized) return;
        const current = get().pinnedLines;
        const has = current.some((l) => normalizeLine(l) === normalized);
        set({
          pinnedLines: has
            ? current.filter((l) => normalizeLine(l) !== normalized)
            : [...current, normalized],
        });
      },
      importBackup: (raw, mode) => {
        const incoming = parseBackupJson(raw);
        const result = mergeImportedCards(get().cards, incoming, mode);
        set({
          cards: result.cards,
          activeId: get().activeId ?? result.cards[0]?.id ?? null,
        });
        return {
          added: result.added,
          replaced: result.replaced,
          skipped: result.skipped,
        };
      },
      replaceAllCards: (cards) => {
        set({
          cards: cards.map(withCardDefaults),
          activeId: cards[0]?.id ?? null,
        });
      },
    }),
    {
      name: "folio-cards-v1",
      version: 4,
      partialize: (state) => ({
        cards: state.cards,
        activeId: state.activeId,
        pinnedLines: state.pinnedLines,
      }),
      migrate: (persisted, version) => {
        const data = (persisted ?? {}) as Persisted;
        const cards = (data.cards ?? []).map(withCardDefaults);
        const activeId =
          data.activeId && cards.some((card) => card.id === data.activeId)
            ? data.activeId
            : (cards[0]?.id ?? null);
        const pinnedLines = Array.isArray(data.pinnedLines)
          ? data.pinnedLines.map(normalizeLine).filter(Boolean)
          : [];
        void version;
        return { cards, activeId, pinnedLines };
      },
    },
  ),
);
