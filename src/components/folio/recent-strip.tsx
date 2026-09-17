import { Clock3, Star } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { BusinessCard } from "@/lib/cards/types";
import { cn } from "@/lib/utils";

const CAP = 8;

type RecentStripProps = {
  cards: BusinessCard[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

export function RecentStrip({ cards, activeId, onSelect }: RecentStripProps) {
  const favorites = useMemo(
    () => cards.filter((c) => c.favorite).slice(0, CAP),
    [cards],
  );

  const recent = useMemo(() => {
    const favIds = new Set(favorites.map((c) => c.id));
    return [...cards]
      .filter((c) => typeof c.lastViewedAt === "number" && c.lastViewedAt > 0)
      .sort((a, b) => (b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0))
      .filter((c) => !favIds.has(c.id))
      .slice(0, CAP);
  }, [cards, favorites]);

  if (favorites.length === 0 && recent.length === 0) return null;

  return (
    <div
      className="relative z-10 flex flex-col gap-1.5 px-4 pb-2 sm:px-6"
      aria-label="Favorites and recent cards"
    >
      {favorites.length > 0 ? (
        <StripRow
          icon={<Star className="size-3.5 fill-current" />}
          label="Favorites"
          cards={favorites}
          activeId={activeId}
          onSelect={onSelect}
        />
      ) : null}
      {recent.length > 0 ? (
        <StripRow
          icon={<Clock3 className="size-3.5" />}
          label="Recent"
          cards={recent}
          activeId={activeId}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}

function StripRow({
  icon,
  label,
  cards,
  activeId,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  cards: BusinessCard[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-subtle">
        {icon}
        {label}
      </span>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5">
        {cards.map((card) => {
          const active = card.id === activeId;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card.id)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2 rounded-full pl-1 pr-3 text-left transition-colors",
                active
                  ? "bg-accent text-accent-fg"
                  : "bg-surface text-muted hover:text-fg",
              )}
              title={card.company || card.personName}
            >
              <img
                src={card.frontImage}
                alt=""
                className="size-7 rounded-full object-cover"
                draggable={false}
              />
              <span className="max-w-[7.5rem] truncate text-xs font-medium">
                {card.company || card.personName || "Card"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
