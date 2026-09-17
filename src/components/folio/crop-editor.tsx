import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const NO_SCALE_VIEWPORT =
  "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

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

function stopBubble(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

export function CropEditor({
  src,
  title = "Crop your photo",
  onConfirm,
  onCancel,
}: CropEditorProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
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

  // Lock page scroll / Chrome viewport pinch-zoom while the crop overlay is open.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlTouch = html.style.touchAction;
    const prevBodyTouch = body.style.touchAction;
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;

    html.style.touchAction = "none";
    body.style.touchAction = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    const viewport = document.querySelector('meta[name="viewport"]');
    const prevViewport = viewport?.getAttribute("content") ?? null;
    if (viewport) {
      viewport.setAttribute("content", NO_SCALE_VIEWPORT);
    }

    const blockPageZoom = (event: Event) => {
      const te = event as TouchEvent;
      // Multi-touch = Chrome/Safari viewport pinch. Always kill it while crop is open.
      if (te.touches && te.touches.length > 1) {
        event.preventDefault();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, [data-crop-controls]")) {
        // Let footer / zoom controls receive normal taps without touchmove cancel.
        return;
      }
      // Single-finger elsewhere: block native scroll/zoom on the document shell.
      event.preventDefault();
    };
    const blockGesture = (event: Event) => {
      event.preventDefault();
    };

    // Non-passive so Chrome cannot pinch-zoom the page behind the overlay.
    document.addEventListener("touchmove", blockPageZoom, { passive: false });
    document.addEventListener("gesturestart", blockGesture, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gesturechange", blockGesture, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gestureend", blockGesture, { passive: false } as AddEventListenerOptions);

    return () => {
      html.style.touchAction = prevHtmlTouch;
      body.style.touchAction = prevBodyTouch;
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
      if (viewport && prevViewport != null) {
        viewport.setAttribute("content", prevViewport);
      }
      document.removeEventListener("touchmove", blockPageZoom);
      document.removeEventListener("gesturestart", blockGesture);
      document.removeEventListener("gesturechange", blockGesture);
      document.removeEventListener("gestureend", blockGesture);
    };
  }, []);

  // Also block on the overlay itself (capture) in case document listeners miss.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onTouchMove = (event: TouchEvent) => {
      const target = event.target as HTMLElement | null;
      const onControls = Boolean(
        target?.closest("button, a, input, textarea, [data-crop-controls]"),
      );
      // Never let multi-touch become page zoom. On the image frame, block native
      // gestures so our pointer pan/pinch owns the interaction.
      if (event.touches.length > 1 || !onControls) {
        event.preventDefault();
      }
    };
    const onGesture = (event: Event) => {
      event.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("gesturestart", onGesture, { passive: false } as AddEventListenerOptions);
    el.addEventListener("gesturechange", onGesture, { passive: false } as AddEventListenerOptions);
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("gesturestart", onGesture);
      el.removeEventListener("gesturechange", onGesture);
    };
  }, []);

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
    // Gestures stay on the image frame only — never the full overlay.
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

  const controlBtn =
    "min-h-11 min-w-11 touch-manipulation relative z-[210]";

  const overlay = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex flex-col bg-bg"
      style={{ touchAction: "none" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="folio-crop-title"
    >
      <header className="relative z-[210] shrink-0 px-5 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <h2
          id="folio-crop-title"
          className="font-display text-2xl font-medium tracking-tight text-fg"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Drag to reposition. Pinch or use the buttons to zoom. The frame matches a
          business card (3.5 × 2).
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center px-4">
        <div
          ref={frameRef}
          className={cn(
            "relative mx-auto touch-none select-none overflow-hidden rounded-lg bg-elevated",
            "folio-aspect w-full max-w-lg cursor-grab active:cursor-grabbing",
          )}
          style={{ touchAction: "none" }}
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

        <div
          data-crop-controls
          className="relative z-[210] mt-4 flex items-center justify-center gap-2"
          style={{ touchAction: "manipulation" }}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={controlBtn}
            disabled={!natural || busy || zoom <= MIN_ZOOM}
            onPointerUp={stopBubble}
            onClick={(event) => {
              stopBubble(event);
              applyZoomAt(zoom / 1.15, frame.w / 2, frame.h / 2);
            }}
            aria-label="Zoom out"
          >
            <ZoomOut />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={controlBtn}
            disabled={!natural || busy}
            onPointerUp={stopBubble}
            onClick={(event) => {
              stopBubble(event);
              reset();
            }}
          >
            <RotateCcw />
            Reset
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={controlBtn}
            disabled={!natural || busy || zoom >= MAX_ZOOM}
            onPointerUp={stopBubble}
            onClick={(event) => {
              stopBubble(event);
              applyZoomAt(zoom * 1.15, frame.w / 2, frame.h / 2);
            }}
            aria-label="Zoom in"
          >
            <ZoomIn />
          </Button>
        </div>
      </div>

      <footer
        data-crop-controls
        className="relative z-[210] flex shrink-0 flex-col-reverse gap-2 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end"
        style={{ touchAction: "manipulation" }}
      >
        <Button
          type="button"
          variant="ghost"
          className={controlBtn}
          disabled={busy}
          onPointerUp={stopBubble}
          onClick={(event) => {
            stopBubble(event);
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className={controlBtn}
          disabled={!natural || busy}
          onPointerUp={stopBubble}
          onClick={(event) => {
            stopBubble(event);
            void confirm();
          }}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : null}
          Use crop
        </Button>
      </footer>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
