import type { ReactNode } from "react";
import {
  Copy,
  Globe,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  QrCode,
  Share2,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { BusinessCard } from "@/lib/cards/types";
import { cardClipboardText, mapsHref, websiteHref } from "@/lib/cards/types";
import { cn } from "@/lib/utils";

type InfoFaceProps = {
  card: BusinessCard;
  onEdit: () => void;
  onDelete: () => void;
  onLine?: (line: string) => void;
  onToggleFavorite?: () => void;
  onShare?: () => void;
  showThumb?: boolean;
};

function Row({
  icon: Icon,
  children,
}: {
  icon: typeof Phone;
  children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm leading-snug">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

function ActionChip({
  icon: Icon,
  label,
  href,
  onClick,
  disabled,
}: {
  icon: typeof Phone;
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className = cn(
    "inline-flex h-9 items-center gap-1.5 rounded-full bg-tab px-3 text-xs font-semibold text-ink transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40",
  );
  if (href && !disabled) {
    return (
      <a
        href={href}
        className={className}
        onClick={(event) => event.stopPropagation()}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel={href.startsWith("http") ? "noreferrer" : undefined}
      >
        <Icon className="size-3.5" />
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

export function InfoFace({
  card,
  onEdit,
  onDelete,
  onLine,
  onToggleFavorite,
  onShare,
  showThumb = false,
}: InfoFaceProps) {
  const site = websiteHref(card.website);
  const maps = mapsHref(card.address);
  const smsHref = card.phone
    ? `sms:${card.phone.replace(/[^\d+]/g, "")}`
    : undefined;
  const telHref = card.phone ? `tel:${card.phone}` : undefined;
  const mailHref = card.email ? `mailto:${card.email}` : undefined;

  const copyAll = async () => {
    const text = cardClipboardText(card);
    if (!text.trim()) {
      toast.error("Nothing to copy yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied card details");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <div
      className="folio-file flex h-full min-h-0 flex-col overflow-hidden bg-paper text-ink"
      data-folio-file
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-4">
        <div className="flex items-start gap-3">
          {showThumb ? (
            <img
              src={card.frontImage}
              alt=""
              className="h-16 w-28 shrink-0 rounded-sm object-cover"
              draggable={false}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {card.line ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onLine?.(card.line);
                  }}
                  className="rounded-full bg-tab px-2.5 py-0.5 text-xs font-semibold tracking-wide text-ink"
                >
                  {card.line}
                </button>
              ) : (
                <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
                  No line yet
                </p>
              )}
              <button
                type="button"
                aria-label={card.favorite ? "Unfavorite" : "Favorite"}
                aria-pressed={Boolean(card.favorite)}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite?.();
                }}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full transition-colors",
                  card.favorite
                    ? "bg-accent text-accent-fg"
                    : "bg-tab/70 text-ink-muted hover:text-ink",
                )}
              >
                <Star
                  className="size-3.5"
                  fill={card.favorite ? "currentColor" : "none"}
                />
              </button>
            </div>
            <p className="mt-1 font-display text-xl font-medium leading-tight tracking-tight">
              {card.company || "Untitled company"}
            </p>
            <p className="mt-0.5 text-sm font-medium leading-snug">
              {card.personName || "Name unknown"}
              {card.title ? (
                <span className="font-normal text-ink-muted"> · {card.title}</span>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5" aria-label="Quick actions">
          {telHref ? <ActionChip icon={Phone} label="Call" href={telHref} /> : null}
          {smsHref ? <ActionChip icon={MessageSquare} label="Text" href={smsHref} /> : null}
          {mailHref ? <ActionChip icon={Mail} label="Email" href={mailHref} /> : null}
          {maps ? <ActionChip icon={MapPin} label="Maps" href={maps} /> : null}
          <ActionChip icon={Copy} label="Copy all" onClick={() => void copyAll()} />
          <ActionChip
            icon={Share2}
            label="Share"
            onClick={() => onShare?.()}
            disabled={!onShare}
          />
          <ActionChip
            icon={QrCode}
            label="QR / vCard"
            onClick={() => onShare?.()}
            disabled={!onShare}
          />
        </div>

        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {card.phone ? (
            <Row icon={Phone}>
              <a
                href={telHref}
                className="text-ink hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {card.phone}
              </a>
            </Row>
          ) : null}
          {card.email ? (
            <Row icon={Mail}>
              <a
                href={mailHref}
                className="text-ink hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {card.email}
              </a>
            </Row>
          ) : null}
          {site ? (
            <Row icon={Globe}>
              <a
                href={site}
                target="_blank"
                rel="noreferrer"
                className="text-ink hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {card.website}
              </a>
            </Row>
          ) : null}
          {card.address ? (
            <Row icon={MapPin}>
              {maps ? (
                <a
                  href={maps}
                  target="_blank"
                  rel="noreferrer"
                  className="line-clamp-2 text-ink hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {card.address}
                </a>
              ) : (
                <span className="line-clamp-2">{card.address}</span>
              )}
            </Row>
          ) : null}
        </ul>

        {card.notes ? (
          <p className="line-clamp-2 text-sm leading-snug text-ink-muted">{card.notes}</p>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="bg-tab text-ink shadow-none hover:bg-accent"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <Pencil />
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-ink-muted hover:bg-tab hover:text-ink"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 />
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}
