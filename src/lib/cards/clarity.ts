/**
 * Softness detection + mild unsharp-mask clarity pass (canvas only, offline).
 * Conservative: only sharpens when the image looks soft; skips crisp shots.
 */

export type ClarityResult = {
  source: ImageBitmap | HTMLCanvasElement;
  sharpened: boolean;
};

const ANALYZE_MAX = 320;
/** Laplacian variance below this → treat as soft (tuned for downscaled analysis). */
const SOFT_THRESHOLD = 120;
/** Above this → already crisp; skip sharpening. */
const CRISP_THRESHOLD = 380;

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function drawScaled(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxSide: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/**
 * Estimate focus / sharpness via variance of a Laplacian-like kernel on luminance.
 * Higher = sharper. Measured on a downscaled copy for speed.
 */
export function estimateSharpness(
  source: CanvasImageSource,
  width: number,
  height: number,
): number {
  const canvas = drawScaled(source, width, height, ANALYZE_MAX);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return CRISP_THRESHOLD; // assume ok → skip
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  // 3×3 Laplacian approximation
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        -gray[i - w] - gray[i - 1] + 4 * gray[i] - gray[i + 1] - gray[i + w];
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  if (n === 0) return CRISP_THRESHOLD;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

/**
 * Mild unsharp mask: sharpened = original + amount * (original - blurred).
 * amount ~0.35–0.7 depending on softness; radius 1 box blur (cheap).
 */
function unsharpMask(
  source: CanvasImageSource,
  width: number,
  height: number,
  amount: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(source, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const src = img.data;

  // Separable box blur radius 1 into a float buffer (RGB only)
  const w = width;
  const h = height;
  const blur = new Float32Array(src.length);

  // Horizontal
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let count = 0;
        for (let k = -1; k <= 1; k++) {
          const xx = Math.max(0, Math.min(w - 1, x + k));
          sum += src[(y * w + xx) * 4 + c];
          count++;
        }
        tmp[i + c] = sum / count;
      }
    }
  }
  // Vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let count = 0;
        for (let k = -1; k <= 1; k++) {
          const yy = Math.max(0, Math.min(h - 1, y + k));
          sum += tmp[(yy * w + x) * 4 + c];
          count++;
        }
        blur[i + c] = sum / count;
      }
    }
  }

  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = src[i + c] + amount * (src[i + c] - blur[i + c]);
      src[i + c] = clampByte(v);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function sourceSize(source: ImageBitmap | HTMLCanvasElement): {
  width: number;
  height: number;
} {
  return { width: source.width, height: source.height };
}

/** Skip full-res unsharp above this width (RGBA + blur buffers get heavy). */
const UNSHARP_MAX_WIDTH = 1200;

/**
 * If the photo looks soft, apply a conservative unsharp mask.
 * Crisp images are left untouched. Failures return the input unchanged.
 * Wide sources (> UNSHARP_MAX_WIDTH) are analyzed only — no full-res unsharp.
 */
export function enhanceClarity(
  source: ImageBitmap | HTMLCanvasElement,
): ClarityResult {
  try {
    const { width, height } = sourceSize(source);
    if (width < 16 || height < 16) {
      return { source, sharpened: false };
    }

    // Always analyze on a tiny downscale; skip full-res unsharp when too wide.
    const sharpness = estimateSharpness(source, width, height);

    if (sharpness >= CRISP_THRESHOLD) {
      return { source, sharpened: false };
    }

    if (width > UNSHARP_MAX_WIDTH) {
      // Analyze-only: photo is soft but unsharp on this size risks OOM.
      return { source, sharpened: false };
    }

    // Map softness → amount. Very soft gets ~0.65; near-threshold gets ~0.3.
    let amount: number;
    if (sharpness <= SOFT_THRESHOLD) {
      amount = 0.65;
    } else {
      const t =
        (CRISP_THRESHOLD - sharpness) / (CRISP_THRESHOLD - SOFT_THRESHOLD);
      amount = 0.3 + 0.35 * Math.min(1, Math.max(0, t));
    }

    const sharpened = unsharpMask(source, width, height, amount);
    return { source: sharpened, sharpened: true };
  } catch {
    return { source, sharpened: false };
  }
}
