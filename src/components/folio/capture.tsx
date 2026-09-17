import { Camera, ImagePlus, LoaderCircle, Pin } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { findDuplicates, type DuplicateMatch } from "@/lib/cards/duplicates";
import { extractCardInfo } from "@/lib/cards/extract";
import { fileToCompressedDataUrl } from "@/lib/cards/image";
import { useCardStore } from "@/lib/cards/store";
import {
  EMPTY_FIELDS,
  LINE_SUGGESTIONS,
  normalizeLine,
  suggestLinesFromText,
  type CardFields,
} from "@/lib/cards/types";
import { cn } from "@/lib/utils";

type Step = "front" | "back" | "reading" | "review" | "duplicate";

export function CaptureDialog() {
  const capture = useCardStore((s) => s.capture);
  const cards = useCardStore((s) => s.cards);
  const pinnedLines = useCardStore((s) => s.pinnedLines);
  const closeCapture = useCardStore((s) => s.closeCapture);
  const addCard = useCardStore((s) => s.addCard);
  const updateCard = useCardStore((s) => s.updateCard);
  const mergeIntoCard = useCardStore((s) => s.mergeIntoCard);
  const togglePinnedLine = useCardStore((s) => s.togglePinnedLine);

  const editingId = capture.kind === "edit" ? capture.id : null;
  const editing = editingId ? cards.find((card) => card.id === editingId) : null;
  const open = capture.kind !== "closed";

  const [step, setStep] = useState<Step>("front");
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [fields, setFields] = useState<CardFields>(EMPTY_FIELDS);
  const [busy, setBusy] = useState(false);
  const [suggestedLines, setSuggestedLines] = useState<string[]>([...LINE_SUGGESTIONS]);
  const [dupes, setDupes] = useState<DuplicateMatch[]>([]);

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const targetSide = useRef<"front" | "back">("front");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setFront(editing.frontImage);
      setBack(editing.backImage);
      setFields({
        company: editing.company,
        personName: editing.personName,
        title: editing.title,
        phone: editing.phone,
        email: editing.email,
        website: editing.website,
        address: editing.address,
        notes: editing.notes,
        line: editing.line ?? "",
      });
      setSuggestedLines(
        suggestLinesFromText(
          [editing.company, editing.title, editing.notes, editing.line].join(" "),
        ),
      );
      setStep("review");
    } else {
      setFront(null);
      setBack(null);
      setFields(EMPTY_FIELDS);
      setSuggestedLines([...LINE_SUGGESTIONS]);
      setStep("front");
    }
    setDupes([]);
    setBusy(false);
    // Only reset when the dialog opens or the target card changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  const lineChips = useMemo(() => {
    const pinned = pinnedLines.map(normalizeLine).filter(Boolean);
    const rest = suggestedLines
      .map(normalizeLine)
      .filter((l) => l && !pinned.includes(l));
    const extras = LINE_SUGGESTIONS.filter(
      (l) => !pinned.includes(l) && !rest.includes(l),
    );
    return [...pinned, ...rest, ...extras];
  }, [pinnedLines, suggestedLines]);

  const pick = (side: "front" | "back", mode: "camera" | "library") => {
    targetSide.current = side;
    const input = mode === "camera" ? cameraRef.current : libraryRef.current;
    input?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { dataUrl, cropped, fitted, cropSkipped } = await fileToCompressedDataUrl(file);
      if (targetSide.current === "front") setFront(dataUrl);
      else setBack(dataUrl);
      if (fitted) {
        toast.message("Fitted card to frame");
      } else if (cropped) {
        toast.message("Card cropped to fit");
      } else if (cropSkipped) {
        toast.message("Couldn't isolate the card — saved full photo");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not use that photo");
    } finally {
      setBusy(false);
    }
  };

  const readCard = async () => {
    if (!front) return;
    if (!front.startsWith("data:image/")) {
      setStep("review");
      return;
    }
    setStep("reading");
    try {
      const result = await extractCardInfo({
        frontImage: front,
        backImage: back?.startsWith("data:image/") ? back : null,
      });
      if (result.ok) {
        setFields({
          ...EMPTY_FIELDS,
          ...result.fields,
        });
        if (result.suggestedLines?.length) {
          setSuggestedLines(result.suggestedLines);
        }
        if (result.fields.line) {
          toast.message(`Suggested line: ${result.fields.line}`);
        }
      } else {
        toast.error(result.error);
        if (result.suggestedLines?.length) {
          setSuggestedLines(result.suggestedLines);
        }
      }
    } catch {
      toast.error("Could not read the card automatically. You can type the details.");
    }
    setStep("review");
  };

  const commitCreate = () => {
    if (!front) return;
    addCard({
      ...fields,
      frontImage: front,
      backImage: back,
    });
    toast.success("Filed by company");
  };

  const commitUpdateExisting = (id: string) => {
    mergeIntoCard(id, {
      ...fields,
      frontImage: front?.startsWith("data:image/") ? front : undefined,
      backImage:
        back === null
          ? null
          : back?.startsWith("data:image/")
            ? back
            : undefined,
    });
    toast.success("Updated existing card");
  };

  const save = () => {
    if (!front) {
      toast.error("Add a photo of the front first.");
      return;
    }
    if (!fields.company.trim() && !fields.personName.trim()) {
      toast.error("Add a company or a name so the card can be filed.");
      return;
    }
    if (editing) {
      updateCard(editing.id, {
        ...fields,
        frontImage: front,
        backImage: back,
      });
      toast.success("Card updated");
      return;
    }

    const matches = findDuplicates(cards, fields);
    if (matches.length > 0) {
      setDupes(matches);
      setStep("duplicate");
      return;
    }
    commitCreate();
  };

  const patch = (key: keyof CardFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
  };

  const side = step === "back" ? "back" : "front";
  const preview = step === "back" ? back : front;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeCapture()}>
      <DialogContent className="p-0">
        {/* Native camera UI (capture=environment) handles continuous AF where the OS supports it;
            there is no getUserMedia preview — post-capture crop + clarity are the in-app fixes. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />

        {step === "reading" ? (
          <ReadingPreview src={front} />
        ) : step === "duplicate" ? (
          <DuplicateChooser
            matches={dupes}
            fields={fields}
            onUpdate={(id) => commitUpdateExisting(id)}
            onCreate={() => commitCreate()}
            onBack={() => setStep("review")}
          />
        ) : step === "review" ? (
          <ReviewForm
            fields={fields}
            front={front}
            back={back}
            lineChips={lineChips}
            pinnedLines={pinnedLines}
            onPatch={patch}
            onTogglePin={togglePinnedLine}
            onReplaceFront={() => {
              setStep("front");
            }}
            onReplaceBack={() => {
              setStep("back");
            }}
            onSave={save}
            onCancel={closeCapture}
            editing={Boolean(editing)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {side === "front" ? "Photograph the front" : "Photograph the back"}
              </DialogTitle>
              <DialogDescription>
                {side === "front"
                  ? "Photograph the card on a contrasting surface. Folio crops it to size and sharpens soft shots."
                  : "Optional. The reverse often holds an address or extra lines."}
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 pb-2">
              <div className="relative overflow-hidden rounded-lg bg-elevated">
                {preview ? (
                  <img
                    src={preview}
                    alt={side === "front" ? "Front of card" : "Back of card"}
                    className="folio-aspect w-full object-cover"
                  />
                ) : (
                  <div className="flex folio-aspect flex-col items-center justify-center gap-2 text-muted">
                    <ImagePlus className="size-7" />
                    <p className="text-sm">No photo yet</p>
                  </div>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => pick(side, "camera")}
                  disabled={busy}
                >
                  <Camera />
                  Take photo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => pick(side, "library")}
                  disabled={busy}
                >
                  <ImagePlus />
                  Choose photo
                </Button>
              </div>
            </div>

            <DialogFooter>
              {side === "front" ? (
                <Button
                  type="button"
                  disabled={!front || busy}
                  onClick={() => setStep("back")}
                >
                  Continue
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void readCard()}
                    disabled={!front || busy}
                  >
                    Skip back
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void readCard()}
                    disabled={!front || busy}
                  >
                    Read the card
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReadingPreview({ src }: { src: string | null }) {
  return (
    <div className="px-6 py-8">
      <DialogHeader className="px-0 pt-0">
        <DialogTitle>Reading the card</DialogTitle>
        <DialogDescription>
          Pulling names, company, and contact lines from the photo.
        </DialogDescription>
      </DialogHeader>
      <div className="relative mt-4 overflow-hidden rounded-lg bg-elevated">
        {src ? (
          <img src={src} alt="" className="folio-aspect w-full object-cover" />
        ) : null}
        <div className="scan-line pointer-events-none absolute inset-x-6 h-px bg-accent" />
        <div className="absolute inset-0 flex items-center justify-center bg-bg/20">
          <LoaderCircle className="size-7 animate-spin text-accent" />
        </div>
      </div>
    </div>
  );
}

function DuplicateChooser({
  matches,
  fields,
  onUpdate,
  onCreate,
  onBack,
}: {
  matches: DuplicateMatch[];
  fields: CardFields;
  onUpdate: (id: string) => void;
  onCreate: () => void;
  onBack: () => void;
}) {
  const primary = matches[0];
  return (
    <>
      <DialogHeader>
        <DialogTitle>Possible duplicate</DialogTitle>
        <DialogDescription>
          Matched by {primary?.reasons.join(", ") || "contact details"}. Update the
          existing card or create a new one.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 px-6 pb-2">
        {matches.slice(0, 3).map((match) => (
          <div
            key={match.card.id}
            className="flex items-center gap-3 rounded-lg bg-elevated p-3"
          >
            <img
              src={match.card.frontImage}
              alt=""
              className="h-12 w-20 rounded-sm object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {match.card.company || "Untitled"}
              </p>
              <p className="truncate text-xs text-muted">
                {match.card.personName}
                {match.card.phone ? ` · ${match.card.phone}` : ""}
              </p>
              <p className="text-[10px] uppercase tracking-widest text-subtle">
                {match.reasons.join(" · ")}
              </p>
            </div>
            <Button type="button" size="sm" onClick={() => onUpdate(match.card.id)}>
              Update existing
            </Button>
          </div>
        ))}
        <p className="text-xs text-muted">
          Incoming: {fields.company || "—"} / {fields.personName || "—"}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="button" variant="secondary" onClick={onCreate}>
          Create new
        </Button>
      </DialogFooter>
    </>
  );
}

function ReviewForm({
  fields,
  front,
  back,
  lineChips,
  pinnedLines,
  onPatch,
  onTogglePin,
  onReplaceFront,
  onReplaceBack,
  onSave,
  onCancel,
  editing,
}: {
  fields: CardFields;
  front: string | null;
  back: string | null;
  lineChips: string[];
  pinnedLines: string[];
  onPatch: (key: keyof CardFields, value: string) => void;
  onTogglePin: (line: string) => void;
  onReplaceFront: () => void;
  onReplaceBack: () => void;
  onSave: () => void;
  onCancel: () => void;
  editing: boolean;
}) {
  const pinnedSet = new Set(pinnedLines.map(normalizeLine));

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? "Edit card" : "Check the file"}</DialogTitle>
        <DialogDescription>
          Filed A to Z by company. Correct anything the photo missed.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onReplaceFront}
            className="overflow-hidden rounded-md bg-elevated"
          >
            {front ? (
              <img src={front} alt="Front" className="folio-aspect w-full object-cover" />
            ) : (
              <div className="flex folio-aspect items-center justify-center text-xs text-muted">
                Front
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={onReplaceBack}
            className="overflow-hidden rounded-md bg-elevated"
          >
            {back ? (
              <img src={back} alt="Back" className="folio-aspect w-full object-cover" />
            ) : (
              <div className="flex folio-aspect items-center justify-center text-xs text-muted">
                Add back
              </div>
            )}
          </button>
        </div>

        <div className="grid gap-3">
          <Field
            label="Company"
            value={fields.company}
            onChange={(v) => onPatch("company", v)}
            autoComplete="organization"
          />
          <Field
            label="Name"
            value={fields.personName}
            onChange={(v) => onPatch("personName", v)}
            autoComplete="name"
          />
          <Field label="Title" value={fields.title} onChange={(v) => onPatch("title", v)} />
          <div className="grid gap-1.5">
            <Label htmlFor="line">Line of work</Label>
            <Input
              id="line"
              value={fields.line}
              onChange={(event) => onPatch("line", event.target.value)}
              placeholder="Construction, Fishing, Glass… or type your own"
              list="folio-line-suggestions"
            />
            <datalist id="folio-line-suggestions">
              {lineChips.map((line) => (
                <option key={line} value={line} />
              ))}
            </datalist>
            <div className="flex flex-wrap gap-1 pt-1">
              {lineChips.slice(0, 16).map((line) => {
                const pinned = pinnedSet.has(normalizeLine(line));
                const selected = normalizeLine(fields.line) === normalizeLine(line);
                return (
                  <div key={line} className="inline-flex items-center">
                    <button
                      type="button"
                      onClick={() => onPatch("line", line)}
                      className={cn(
                        "h-8 rounded-l-full px-3 text-xs font-medium",
                        selected
                          ? "bg-accent text-accent-fg"
                          : "bg-elevated text-muted hover:text-fg",
                      )}
                    >
                      {line}
                    </button>
                    <button
                      type="button"
                      title={pinned ? "Unpin line" : "Pin line"}
                      aria-label={pinned ? `Unpin ${line}` : `Pin ${line}`}
                      onClick={() => onTogglePin(line)}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-r-full border-l border-border/40",
                        pinned
                          ? "bg-accent text-accent-fg"
                          : "bg-elevated text-subtle hover:text-fg",
                      )}
                    >
                      <Pin className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <Field
            label="Phone"
            value={fields.phone}
            onChange={(v) => onPatch("phone", v)}
            inputMode="tel"
          />
          <Field
            label="Email"
            value={fields.email}
            onChange={(v) => onPatch("email", v)}
            inputMode="email"
          />
          <Field
            label="Website"
            value={fields.website}
            onChange={(v) => onPatch("website", v)}
          />
          <Field
            label="Address"
            value={fields.address}
            onChange={(v) => onPatch("address", v)}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={fields.notes}
              onChange={(event) => onPatch("notes", event.target.value)}
              rows={3}
            />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{editing ? "Save changes" : "File this card"}</Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange">) {
  const id = label.toLowerCase();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </div>
  );
}
