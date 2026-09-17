import { Download, Menu, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  PRIVACY_BACKUP_HINT,
  PRIVACY_MESSAGE,
} from "@/components/folio/privacy-note";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadBackupJson } from "@/lib/cards/backup";
import { useCardStore } from "@/lib/cards/store";
import { cn } from "@/lib/utils";

export function SettingsMenu() {
  const cards = useCardStore((s) => s.cards);
  const importBackup = useCardStore((s) => s.importBackup);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pendingRaw, setPendingRaw] = useState<string | null>(null);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const raw = await file.text();
      setPendingRaw(raw);
    } catch {
      toast.error("Could not read that file");
    }
  };

  const runImport = (mode: "skip" | "replace") => {
    if (!pendingRaw) return;
    try {
      const result = importBackup(pendingRaw, mode);
      toast.success(
        `Import done — ${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped`,
      );
      setPendingRaw(null);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
      setPendingRaw(null);
    }
  };

  return (
    <>
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 text-muted hover:text-fg"
          aria-label="Settings"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Menu className="size-5" />
        </Button>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            />
            <div
              className={cn(
                "absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg bg-surface shadow-[var(--shadow-tray)]",
              )}
              role="menu"
            >
              <div className="border-b border-border px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-widest text-subtle">
                  Privacy
                </p>
                <p className="mt-1 text-xs leading-snug text-muted">
                  {PRIVACY_MESSAGE} {PRIVACY_BACKUP_HINT}
                </p>
              </div>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-fg hover:bg-elevated"
                onClick={() => {
                  downloadBackupJson(cards);
                  toast.success("Backup downloaded");
                  setOpen(false);
                }}
              >
                <Download className="size-4 text-muted" />
                Export JSON backup
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-fg hover:bg-elevated"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4 text-muted" />
                Import JSON…
              </button>
            </div>
          </>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          void onPickFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <Dialog open={Boolean(pendingRaw)} onOpenChange={(next) => !next && setPendingRaw(null)}>
        <DialogContent className="p-0">
          <DialogHeader>
            <DialogTitle>Import backup</DialogTitle>
            <DialogDescription>
              Cards with the same id already in Folio can be skipped or replaced.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingRaw(null)}>
              Cancel
            </Button>
            <Button type="button" variant="secondary" onClick={() => runImport("skip")}>
              Skip existing
            </Button>
            <Button type="button" onClick={() => runImport("replace")}>
              Replace existing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
