import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CaptureDialog } from "@/components/folio/capture";
import { RecentStrip } from "@/components/folio/recent-strip";
import { PrivacyNote } from "@/components/folio/privacy-note";
import { SettingsMenu } from "@/components/folio/settings-menu";
import { ShareSheet } from "@/components/folio/share-sheet";
import { RolodexWheel } from "@/components/folio/wheel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCardStore } from "@/lib/cards/store";
import type { BusinessCard } from "@/lib/cards/types";
import {
  matchesLine,
  matchesQuery,
  normalizeLine,
  sortCards,
  uniqueLines,
} from "@/lib/cards/types";
import { cn } from "@/lib/utils";

export function FolioApp() {
  const cards = useCardStore((s) => s.cards);
  const query = useCardStore((s) => s.query);
  const lineFilter = useCardStore((s) => s.lineFilter);
  const activeId = useCardStore((s) => s.activeId);
  const pinnedLines = useCardStore((s) => s.pinnedLines);
  const setQuery = useCardStore((s) => s.setQuery);
  const setLineFilter = useCardStore((s) => s.setLineFilter);
  const setActiveId = useCardStore((s) => s.setActiveId);
  const openCreate = useCardStore((s) => s.openCreate);
  const openEdit = useCardStore((s) => s.openEdit);
  const removeCard = useCardStore((s) => s.removeCard);
  const toggleFavorite = useCardStore((s) => s.toggleFavorite);
  const togglePinnedLine = useCardStore((s) => s.togglePinnedLine);

  const [shareCard, setShareCard] = useState<BusinessCard | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const lines = useMemo(() => {
    const all = uniqueLines(cards);
    const pinned = pinnedLines
      .map(normalizeLine)
      .filter((l) => l && all.includes(l));
    const rest = all.filter((l) => !pinned.includes(l));
    return [...pinned, ...rest];
  }, [cards, pinnedLines]);

  const visible = useMemo(() => {
    return sortCards(cards)
      .filter((card) => matchesQuery(card, query))
      .filter((card) => matchesLine(card, lineFilter));
  }, [cards, query, lineFilter]);

  useEffect(() => {
    if (visible.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!visible.some((card) => card.id === activeId)) {
      setActiveId(visible[0].id);
    }
  }, [activeId, setActiveId, visible]);

  // Deep link: ?add=1 opens Add Card / camera on launch
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("add") === "1") {
        openCreate();
        params.delete("add");
        const next = params.toString();
        const url = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", url);
      }
    } catch {
      // ignore
    }
  }, [openCreate]);

  const onDelete = (id: string) => {
    const card = cards.find((item) => item.id === id);
    const label = card?.company || card?.personName || "this card";
    if (window.confirm(`Remove ${label} from the file?`)) {
      removeCard(id);
    }
  };

  const activeCard = cards.find((c) => c.id === activeId) ?? null;

  return (
    <div className="relative isolate flex h-dvh flex-col overflow-hidden text-fg">
      <div className="folio-vignette" />
      <div className="folio-grain" />

      <header className="folio-header relative z-10 grid grid-cols-[1fr_auto_auto] items-center gap-2 px-4 pb-2 sm:grid-cols-[auto_1fr_auto_auto] sm:px-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted max-sm:hidden">
            Rotary file
          </p>
          <h1 className="font-display text-3xl font-medium leading-none tracking-tight text-fg sm:text-4xl">
            Folio
          </h1>
        </div>
        <label className="relative col-span-3 min-w-0 sm:col-span-1 sm:max-w-xs sm:justify-self-end">
          <span className="sr-only">Find a company</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a company or line"
            className="h-11 bg-surface pl-9"
          />
        </label>
        <SettingsMenu />
        <Button type="button" onClick={openCreate} className="shrink-0">
          <Plus />
          Add card
        </Button>
      </header>

      <PrivacyNote />

      {lines.length > 0 ? (
        <div
          className="relative z-10 flex flex-nowrap gap-1 overflow-x-auto overscroll-x-contain px-4 pb-2 sm:px-6"
          aria-label="Filter by line of work"
        >
          <LineChip
            label="All"
            active={!lineFilter}
            onClick={() => setLineFilter("")}
          />
          {lines.map((line) => {
            const pinned = pinnedLines.some(
              (l) => normalizeLine(l) === normalizeLine(line),
            );
            return (
              <LineChip
                key={line}
                label={line}
                active={lineFilter === line}
                pinned={pinned}
                onClick={() => setLineFilter(lineFilter === line ? "" : line)}
                onPin={() => togglePinnedLine(line)}
              />
            );
          })}
        </div>
      ) : null}

      <RecentStrip cards={cards} activeId={activeId} onSelect={setActiveId} />

      <main className="folio-main relative z-10 flex min-h-0 flex-1 flex-col px-2 sm:px-4">
        {visible.length === 0 ? (
          <EmptyState
            filtered={cards.length > 0}
            onAdd={openCreate}
            onClear={() => {
              setQuery("");
              setLineFilter("");
            }}
          />
        ) : (
          <RolodexWheel
            cards={visible}
            activeId={activeId}
            onActiveId={setActiveId}
            onEdit={openEdit}
            onDelete={onDelete}
            onLine={setLineFilter}
            onToggleFavorite={toggleFavorite}
            onShare={(id) => {
              const card = cards.find((c) => c.id === id) ?? null;
              setShareCard(card);
              setShareOpen(true);
            }}
          />
        )}
      </main>

      <CaptureDialog />
      <ShareSheet
        card={shareCard ?? activeCard}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
}

function LineChip({
  label,
  active,
  pinned,
  onClick,
  onPin,
}: {
  label: string;
  active: boolean;
  pinned?: boolean;
  onClick: () => void;
  onPin?: () => void;
}) {
  return (
    <div className="inline-flex shrink-0 items-center">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "h-9 rounded-full px-3 text-xs font-medium tracking-wide transition-colors duration-150",
          onPin ? "rounded-r-none" : "",
          active
            ? "bg-accent text-accent-fg"
            : "bg-surface text-muted hover:text-fg",
        )}
      >
        {pinned && label !== "All" ? `★ ${label}` : label}
      </button>
      {onPin ? (
        <button
          type="button"
          title={pinned ? "Unpin" : "Pin favorite line"}
          aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
          onClick={onPin}
          className={cn(
            "flex h-9 w-7 items-center justify-center rounded-r-full text-xs",
            pinned || active
              ? "bg-accent text-accent-fg"
              : "bg-surface text-subtle hover:text-fg",
          )}
        >
          {pinned ? "★" : "☆"}
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({
  filtered,
  onAdd,
  onClear,
}: {
  filtered: boolean;
  onAdd: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-2xl font-medium tracking-tight">
        {filtered ? "Nothing in that line" : "The file is empty"}
      </p>
      <p className="max-w-sm text-sm text-muted">
        {filtered
          ? "Clear the line or search, or photograph another card."
          : "Photograph a card and it will be read, then filed A to Z by company."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {filtered ? (
          <Button type="button" variant="secondary" onClick={onClear}>
            Show all
          </Button>
        ) : null}
        <Button type="button" onClick={onAdd}>
          <Plus />
          Add card
        </Button>
      </div>
    </div>
  );
}
