import { Download, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BusinessCard } from "@/lib/cards/types";
import {
  buildVCard,
  canNativeShare,
  downloadVCard,
  shareCard,
  vcardQrDataUrl,
} from "@/lib/cards/share";

type ShareSheetProps = {
  card: BusinessCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShareSheet({ card, open, onOpenChange }: ShareSheetProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !card) {
      setQr(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void vcardQrDataUrl(card)
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) {
          setQr(null);
          toast.error("Could not build QR code");
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, card]);

  if (!card) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0">
        <DialogHeader>
          <DialogTitle>Share contact</DialogTitle>
          <DialogDescription>
            Download a vCard, show a QR code, or share with another app.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 px-6 pb-2">
          <div className="overflow-hidden rounded-lg bg-paper p-3 shadow-[var(--shadow-card)]">
            {qr ? (
              <img src={qr} alt="vCard QR code" className="size-52" />
            ) : (
              <div className="flex size-52 items-center justify-center text-sm text-ink-muted">
                {busy ? "Building QR…" : "QR unavailable"}
              </div>
            )}
          </div>
          <p className="max-w-xs text-center text-xs text-muted">
            Scan to import {card.personName || card.company || "this contact"} as a vCard.
          </p>
          <pre className="max-h-24 w-full overflow-auto rounded-md bg-elevated p-2 text-[10px] leading-snug text-muted">
            {buildVCard(card)}
          </pre>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              downloadVCard(card);
              toast.success("Downloaded .vcf");
            }}
          >
            <Download />
            Download .vcf
          </Button>
          {canNativeShare() ? (
            <Button
              type="button"
              onClick={() => {
                void (async () => {
                  const result = await shareCard(card);
                  if (result === "shared") toast.success("Shared");
                  else if (result === "copied") toast.success("Copied vCard text");
                  else toast.message("Share cancelled");
                })();
              }}
            >
              <Share2 />
              Share
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => {
                void (async () => {
                  const result = await shareCard(card);
                  if (result === "copied") toast.success("Copied vCard text");
                  else toast.error("Sharing is not available here");
                })();
              }}
            >
              <Share2 />
              Copy vCard
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
