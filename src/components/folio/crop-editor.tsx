import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { LoaderCircle, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CARD_ASPECT } from "@/lib/cards/crop";
import { applyPanZoomCrop } from "@/lib/cards/image-crop";
import { cn } from "@/lib/utils";

type CropEditorProps = {
  src: string;
  title?: string;
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function coverScale(nw: number, nh: number, vw: number, vh: number) {
  return Math.max(vw / Math.max(nw, 1), vh / Math.max(nh, 1));
}

function clampPan(
  panX: number,
  panY: number,
  zoom: number,
  nw: number,
  nh: number,
  vw: number,
  vh: number,
) {
  const base = coverScale(nw, nh, vw, vh);
  const displayW = nw * base * zoom;
  const displayH = nh * base * zoom;
  const maxX = Math.max(0, (displayW - vw) / 2);
  const maxY = Math.max(0, (displayH - vh) / 2);
  return {
    panX: clamp(panX, -maxX, maxX),
    panY: clamp(panY, -maxY, maxY),
  };
}

export function CropEditor({
  src,
  title = "Adjust crop",
  onConfirm,
  onCancel,
}: CropEditorProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState({ w: 320, h: 320 / CARD_ASPECT });
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [busy, setBusy] = useState(false);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    mode: "pan" | "pinch";
    startZoom: number;
    startPanX: number;
    startPanY: number;
    startDist: number;
    startMidX: number;
    startMidY: number;
    lastX: number;
    lastY: number;
  } | null>(null);

  // Keep latest transform in a ref for gesture handlers without stale closures.
  const transformRef = useRef({ zoom, panX, panY, natural, frame });
  transformRef.current = { zoom, panX, panY, natural, frame };

  useEffect(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setNatural(null);
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setNatural(null);
    img.src = src;
  }, [src]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setFrame({ w, h: w / CARD_ASPECT });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const reset = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  const applyZoomAt = useCallback((nextZoom: number, localX: number, localY: number) => {
    const { zoom: prevZoom, panX: prevPanX, panY: prevPanY, natural: nat, frame: fr } =
      transformRef.current;
    if (!nat) return;
    const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const cx = fr.w / 2;
    const cy = fr.h / 2;
    const ratio = z / Math.max(prevZoom, 0.0001);
    const newPanX = localX - cx - (localX - cx - prevPanX) * ratio;
    const newPanY = localY - cy - (localY - cy - prevPanY) * ratio;
    const clamped = clampPan(newPanX, newPanY, z, nat.w, nat.h, fr.w, fr.h);
    setZoom(z);
    setPanX(clamped.panX);
    setPanY(clamped.panY);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const { zoom: z, panX: px, panY: py } = transformRef.current;
    if (pointers.current.size === 1) {
      gesture.current = {
        mode: "pan",
        startZoom: z,
        startPanX: px,
        startPanY: py,
        startDist: 0,
        startMidX: event.clientX,
        startMidY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
      };
    } else if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      gesture.current = {
        mode: "pinch",
        startZoom: z,
        startPanX: px,
        startPanY: py,
        startDist: Math.max(dist, 1),
        startMidX: (pts[0].x + pts[1].x) / 2,
        startMidY: (pts[0].y + pts[1].y) / 2,
        lastX: (pts[0].x + pts[1].x) / 2,
        lastY: (pts[0].y + pts[1].y) / 2,
      };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const { natural: nat, frame: fr, panX: px, panY: py, zoom: z } =
      transformRef.current;
    if (!nat) return;
    const g = gesture.current;

    if (g.mode === "pan" && pointers.current.size === 1) {
      const dx = event.clientX - g.lastX;
      const dy = event.clientY - g.lastY;
      g.lastX = event.clientX;
      g.lastY = event.clientY;
      const next = clampPan(px + dx, py + dy, z, nat.w, nat.h, fr.w, fr.h);
      setPanX(next.panX);
      setPanY(next.panY);
      return;
    }

    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const rect = frameRef.current?.getBoundingClientRect();
      const localX = rect ? midX - rect.left : fr.w / 2;
      const localY = rect ? midY - rect.top : fr.h / 2;
      const nextZoom = clamp(
        g.startZoom * (dist / g.startDist),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const aboutRatio = nextZoom / Math.max(g.startZoom, 0.0001);
      const cx = fr.w / 2;
      const cy = fr.h / 2;
      const panX2 = localX - cx - (localX - cx - g.startPanX) * aboutRatio;
      const panY2 = localY - cy - (localY - cy - g.startPanY) * aboutRatio;
      const clamped = clampPan(panX2, panY2, nextZoom, nat.w, nat.h, fr.w, fr.h);
      setZoom(nextZoom);
      setPanX(clamped.panX);
      setPanY(clamped.panY);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const { zoom: z, panX: px, panY: py } = transformRef.current;
    if (pointers.current.size === 0) {
      gesture.current = null;
    } else if (pointers.current.size === 1) {
      const remaining = [...pointers.current.values()][0];
      gesture.current = {
        mode: "pan",
        startZoom: z,
        startPanX: px,
        startPanY: py,
        startDist: 0,
        startMidX: remaining.x,
        startMidY: remaining.y,
        lastX: remaining.x,
        lastY: remaining.y,
      };
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = frameRef.current?.getBoundingClientRect();
    const localX = rect ? event.clientX - rect.left : frame.w / 2;
    const localY = rect ? event.clientY - rect.top : frame.h / 2;
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    applyZoomAt(transformRef.current.zoom * factor, localX, localY);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const dataUrl = await applyPanZoomCrop(
        src,
        { zoom, panX, panY },
        { width: frame.w, height: frame.h },
      );
      onConfirm(dataUrl);
    } catch {
      onConfirm(src);
    } finally {
      setBusy(false);
    }
  };

  const base =
    natural != null ? coverScale(natural.w, natural.h, frame.w, frame.h) : 1;
  const displayW = natural ? natural.w * base * zoom : frame.w;
  const displayH = natural ? natural.h * base * zoom : frame.h;
  const left = (frame.w - displayW) / 2 + panX;
  const top = (frame.h - displayH) / 2 + panY;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Drag to reposition. Pinch or use the buttons to zoom. The frame matches a
          business card (3.5 × 2).
        </DialogDescription>
      </DialogHeader>

      <div className="px-6 pb-2">
        <div
          ref={frameRef}
          className={cn(
            "relative touch-none select-none overflow-hidden rounded-lg bg-elevated",
            "folio-aspect w-full cursor-grab active:cursor-grabbing",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {natural ? (
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none outline-none"
              style={{
                width: displayW,
                height: displayH,
                left,
                top,
              }}
            />
          ) : (
            <div className="flex folio-aspect items-center justify-center">
              <LoaderCircle className="size-6 animate-spin text-muted" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-fg/20" />
        </div>

        <div className="mt-3 flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!natural || busy || zoom <= MIN_ZOOM}
            onClick={() => applyZoomAt(zoom / 1.15, frame.w / 2, frame.h / 2)}
            aria-label="Zoom out"
          >
            <ZoomOut />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!natural || busy}
            onClick={reset}
          >
            <RotateCcw />
            Reset
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!natural || busy || zoom >= MAX_ZOOM}
            onClick={() => applyZoomAt(zoom * 1.15, frame.w / 2, frame.h / 2)}
            aria-label="Zoom in"
          >
            <ZoomIn />
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void confirm()} disabled={!natural || busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : null}
          Use crop
        </Button>
      </DialogFooter>
    </>
  );
}
