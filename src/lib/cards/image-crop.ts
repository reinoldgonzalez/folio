import { CARD_ASPECT } from "./crop";
import { compressImage } from "./image";

export type PanZoomTransform = {
  /** Zoom relative to cover (≥ 1). */
  zoom: number;
  /** Pan in viewport pixels from centered cover. */
  panX: number;
  /** Pan in viewport pixels from centered cover. */
  panY: number;
};

function coverScale(nw: number, nh: number, vw: number, vh: number) {
  return Math.max(vw / Math.max(nw, 1), vh / Math.max(nh, 1));
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load photo for crop"));
    img.src = dataUrl;
  });
}

/**
 * Apply a fixed card-aspect crop with pan/zoom-over-cover semantics.
 * Uses a virtual viewport width of 1000px so export is independent of on-screen size
 * when pan was recorded against a measured frame — callers must pass pan/zoom that
 * were computed against the same aspect and relative cover math.
 *
 * For UI that measures a real frame, pass `viewport` matching that frame size so
 * panX/panY (in those pixels) map correctly.
 */
export async function applyPanZoomCrop(
  dataUrl: string,
  transform: PanZoomTransform,
  viewport?: { width: number; height: number },
): Promise<string> {
  const img = await loadImage(dataUrl);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const vw = viewport?.width ?? 1000;
  const vh = viewport?.height ?? vw / CARD_ASPECT;
  const zoom = Math.max(1, transform.zoom);

  const base = coverScale(nw, nh, vw, vh);
  const displayW = nw * base * zoom;
  const displayH = nh * base * zoom;
  const left = (vw - displayW) / 2 + transform.panX;
  const top = (vh - displayH) / 2 + transform.panY;

  // Viewport → source image pixels
  const sx = ((0 - left) * nw) / displayW;
  const sy = ((0 - top) * nh) / displayH;
  const sw = (vw * nw) / displayW;
  const sh = (vh * nh) / displayH;

  const outW = Math.min(1200, Math.max(1, Math.round(sw)));
  const outH = Math.max(1, Math.round(outW / CARD_ASPECT));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not crop this photo");
  ctx.fillStyle = "#f4eee4";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

  return compressImage(canvas);
}
