import { cn } from "@/lib/utils";
import type { BusinessCard, CardFace } from "@/lib/cards/types";
import { companyLetter } from "@/lib/cards/types";

type FlipCardProps = {
  card: BusinessCard;
  face: CardFace;
  onCycle?: () => void;
};

function reverseFace(card: BusinessCard) {
  const letter = companyLetter(card.company);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-paper px-6 text-center text-ink">
      <span className="font-display text-6xl font-medium leading-none tracking-tight">
        {letter}
      </span>
      <span className="text-sm tracking-wide text-ink-muted">
        {card.company || "No company"}
      </span>
      <span className="text-xs uppercase tracking-widest text-ink-muted">Reverse</span>
    </div>
  );
}

export function FlipCard({ card, face, onCycle }: FlipCardProps) {
  const showBack = face === "back";
  const interactive = Boolean(onCycle);
  const Frame = interactive ? "button" : "div";

  return (
    <Frame
      type={interactive ? "button" : undefined}
      onClick={onCycle}
      aria-label={
        interactive
          ? `Flip ${card.company || card.personName || "card"}`
          : undefined
      }
      className={cn(
        "folio-card relative overflow-hidden rounded-md bg-elevated text-left shadow-[var(--shadow-card)]",
        interactive ? "cursor-pointer" : "cursor-default",
      )}
    >
      {showBack ? (
        card.backImage ? (
          <img
            src={card.backImage}
            alt={`${card.company} business card, back`}
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          reverseFace(card)
        )
      ) : (
        <img
          src={card.frontImage}
          alt={`${card.company} business card, front`}
          className="h-full w-full object-contain"
          draggable={false}
        />
      )}
    </Frame>
  );
}
