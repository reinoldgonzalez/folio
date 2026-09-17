import { Shield, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export const PRIVACY_NOTE_KEY = "folio-privacy-note-dismissed-v1";

export const PRIVACY_MESSAGE =
  "Folio stays on this device. Share the app link — others get their own empty Folio, not yours.";

export const PRIVACY_BACKUP_HINT =
  "Export a JSON backup from the menu if you switch browsers or clear site data.";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(PRIVACY_NOTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(PRIVACY_NOTE_KEY, "1");
  } catch {
    // ignore quota / private mode
  }
}

/** Lightweight first-run banner — dismissible, persisted in localStorage. */
export function PrivacyNote() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!readDismissed());
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    writeDismissed();
    setVisible(false);
  };

  return (
    <div
      className="relative z-10 mx-4 mb-2 flex items-start gap-3 rounded-lg bg-elevated px-3 py-2.5 shadow-[var(--shadow-tray)] sm:mx-6"
      role="status"
      aria-live="polite"
    >
      <Shield className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <p className="min-w-0 flex-1 text-sm leading-snug text-fg">
        <span className="font-medium">Private to this browser. </span>
        {PRIVACY_MESSAGE}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted hover:text-fg"
        aria-label="Dismiss privacy note"
        onClick={dismiss}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
