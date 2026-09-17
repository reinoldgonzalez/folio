import { ChevronDown, ChevronUp } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { FlipCard } from "@/components/folio/flip-card";
import { InfoFace } from "@/components/folio/info-face";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BusinessCard, CardFace } from "@/lib/cards/types";
import { companyLetter, nextFace } from "@/lib/cards/types";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
const FACES: { id: CardFace; label: string }[] = [
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "info", label: "Details" },
];

type WheelProps = {
  cards: BusinessCard[];
  activeId: string | null;
  onActiveId: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onLine: (line: string) => void;
  onToggleFavorite: (id: string) => void;
  onShare: (id: string) => void;
};

export function RolodexWheel({
  cards,
  activeId,
  onActiveId,
  onEdit,
  onDelete,
  onLine,
  onToggleFavorite,
  onShare,
}: WheelProps) {
  const wheelAcc = useRef(0);
  const locked = useRef(false);
  const [face, setFace] = useState<CardFace>("front");
  const details = face === "info";

  const activeIndex = Math.max(
    0,
    cards.findIndex((card) => card.id === activeId),
  );
  const active = cards[activeIndex] ?? null;

  const letterSet = useMemo(() => {
    const set = new Set<string>();
    for (const card of cards) set.add(companyLetter(card.company));
    return set;
  }, [cards]);

  const firstByLetter = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of cards) {
      const letter = companyLetter(card.company);
      if (!map.has(letter)) map.set(letter, card.id);
    }
    return map;
  }, [cards]);

  const go = useCallback(
    (delta: number) => {
      if (locked.current) return;
      const next = Math.min(cards.length - 1, Math.max(0, activeIndex + delta));
      const card = cards[next];
      if (!card || card.id === active?.id) return;
      locked.current = true;
      onActiveId(card.id);
      window.setTimeout(() => {
        locked.current = false;
      }, 110);
    },
    [active?.id, activeIndex, cards, onActiveId],
  );

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[role='dialog'], input, textarea")) return;
      event.preventDefault();
      // Trackpads send many small deltas — a lower threshold feels more
      // "alive," and leftover delta keeps a fling from feeling sticky.
      wheelAcc.current += event.deltaY;
      const step = 22;
      if (Math.abs(wheelAcc.current) < step) return;
      const dir = wheelAcc.current > 0 ? 1 : -1;
      wheelAcc.current -= dir * step;
      go(dir);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [go]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setFace((current) => nextFace(current));
      return;
    }
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      go(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (cards[0]) onActiveId(cards[0].id);
    } else if (event.key === "End") {
      event.preventDefault();
      const last = cards[cards.length - 1];
      if (last) onActiveId(last.id);
    }
  };

  // Pointer swipe on the stage: FlipCard is a <button>, so old touch
  // handlers that skipped buttons never saw swipes on the card itself.
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const onStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (details) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[role='dialog'], input, textarea, a, nav")) return;
    // Ignore chrome controls; allow FlipCard / card surface.
    if (target?.closest("[data-folio-chrome='true']")) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    suppressClick.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onStagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) > 8) state.moved = true;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      event.preventDefault();
    }
  };

  const finishStagePointer = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    // Vertical swipe changes cards; small tap still reaches FlipCard onClick.
    if (Math.abs(dy) >= 28 && Math.abs(dy) > Math.abs(dx) * 1.1) {
      suppressClick.current = true;
      go(dy < 0 ? 1 : -1); // finger up → next (like rolling the file forward)
    }
  };

  const onStageClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  if (!active) return null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="listbox"
      aria-label="Business card file, A to Z by company"
      aria-activedescendant={active.id}
    >
      <div className="flex min-h-0 flex-1 items-stretch gap-1 overflow-hidden">
        <div className="flex w-11 shrink-0 flex-col items-center justify-center gap-2" data-folio-chrome="true">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-muted hover:text-fg"
            onClick={() => go(-1)}
            disabled={activeIndex === 0}
            aria-label="Previous card"
          >
            <ChevronUp className="size-5" />
          </Button>
          <p className="text-xs tabular-nums text-subtle">
            {activeIndex + 1}/{cards.length}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-muted hover:text-fg"
            onClick={() => go(1)}
            disabled={activeIndex === cards.length - 1}
            aria-label="Next card"
          >
            <ChevronDown className="size-5" />
          </Button>
        </div>

        <div
          className={cn(
            "folio-stage relative min-h-0 flex-1 touch-none overflow-hidden outline-none",
            details && "flex items-stretch",
          )}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={finishStagePointer}
          onPointerCancel={finishStagePointer}
          onClickCapture={onStageClickCapture}
        >
          {details ? (
            <div className="grid h-full min-h-0 w-full grid-cols-1 gap-3 p-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)]">
              <div className="hidden min-h-0 items-center justify-center md:flex">
                <FlipCard card={active} face="front" />
              </div>
              <InfoFace
                card={active}
                showThumb
                onEdit={() => onEdit(active.id)}
                onDelete={() => onDelete(active.id)}
                onLine={onLine}
                onToggleFavorite={() => onToggleFavorite(active.id)}
                onShare={() => onShare(active.id)}
              />
            </div>
          ) : (
            cards.map((card, index) => {
              const offset = index - activeIndex;
              if (Math.abs(offset) > 1) return null;
              const isActive = offset === 0;
              return (
                <div
                  key={card.id}
                  id={card.id}
                  role="option"
                  aria-selected={isActive}
                  className="folio-slot"
                  style={
                    {
                      "--ty": `${offset * 232}px`,
                      "--sc": `${1 - Math.abs(offset) * 0.14}`,
                      zIndex: 10 - Math.abs(offset),
                      opacity: isActive ? 1 : 0.28,
                    } as CSSProperties
                  }
                >
                  {isActive ? (
                    <FlipCard
                      card={card}
                      face={face}
                      onCycle={() => setFace((current) => nextFace(current))}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onActiveId(card.id)}
                      className="folio-card overflow-hidden rounded-md shadow-[var(--shadow-card)]"
                      aria-label={`Open ${card.company}`}
                    >
                      <img
                        src={card.frontImage}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <nav
          aria-label="Jump to letter"
          className="flex w-8 shrink-0 flex-col items-center justify-center gap-0.5 overflow-y-auto overscroll-contain py-2"
        >
          {LETTERS.filter((letter) => letterSet.has(letter)).map((letter) => {
            const current = companyLetter(active.company) === letter;
            return (
              <button
                key={letter}
                type="button"
                onClick={() => {
                  const id = firstByLetter.get(letter);
                  if (id) onActiveId(id);
                }}
                className={cn(
                  "flex h-7 w-8 items-center justify-center rounded-sm text-xs font-semibold tracking-wide transition-colors duration-150",
                  current
                    ? "bg-accent text-accent-fg"
                    : "text-muted hover:bg-elevated hover:text-fg",
                )}
                aria-label={`Jump to ${letter}`}
                aria-current={current ? "true" : undefined}
              >
                {letter}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="relative z-20 flex shrink-0 flex-col items-center gap-1.5 bg-bg px-3 pb-3 pt-1">
        {details ? null : (
          <div className="text-center">
            <p className="font-display text-xl font-medium tracking-tight text-fg">
              {active.company || "No company"}
            </p>
            <p className="text-sm text-muted">
              {active.personName}
              {active.title ? ` · ${active.title}` : ""}
            </p>
          </div>
        )}
        <div className="flex items-center justify-center gap-1">
          {FACES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFace(item.id)}
              className={cn(
                "h-10 rounded-full px-4 text-xs font-medium tracking-wide transition-colors duration-150",
                face === item.id
                  ? "bg-accent text-accent-fg"
                  : "text-muted hover:text-fg",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
