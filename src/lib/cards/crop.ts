/** Client-side business-card region detection + perspective warp (no OpenCV). */

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL

/** Standard US business card aspect (3.5 × 2). */
export const CARD_ASPECT = 3.5 / 2;

const ANALYZE_MAX = 420;
const MIN_AREA_RATIO = 0.1;
const MAX_AREA_RATIO = 0.92;
const MIN_SCORE = 0.42;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Order four points as TL, TR, BR, BL. */
export function orderQuad(pts: Point[]): Quad {
  const sorted = [...pts].sort((a, b) => a.y - b.y || a.x - b.x);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function quadArea(q: Quad): number {
  // Shoelace
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += q[i].x * q[j].y - q[j].x * q[i].y;
  }
  return Math.abs(a) / 2;
}

function sideLengths(q: Quad): [number, number, number, number] {
  return [dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0])];
}

function scoreQuad(q: Quad, imgW: number, imgH: number): number {
  const area = quadArea(q);
  const imgArea = imgW * imgH;
  const areaRatio = area / imgArea;
  if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO) return 0;

  const [top, right, bottom, left] = sideLengths(q);
  const avgW = (top + bottom) / 2;
  const avgH = (left + right) / 2;
  if (avgW < 8 || avgH < 8) return 0;

  const aspect = Math.max(avgW, avgH) / Math.min(avgW, avgH);
  // Prefer ~1.75 (or portrait inverse)
  const aspectErr = Math.min(
    Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT,
    Math.abs(aspect - 1 / CARD_ASPECT) / (1 / CARD_ASPECT),
    Math.abs(aspect - 1.4) / 1.4, // tolerate slightly square-ish cards
  );
  const aspectScore = clamp(1 - aspectErr * 1.4, 0, 1);

  // Parallelism / rectangularity: opposite sides similar length
  const oppW = 1 - Math.abs(top - bottom) / Math.max(top, bottom, 1);
  const oppH = 1 - Math.abs(left - right) / Math.max(left, right, 1);
  const rectScore = (oppW + oppH) / 2;

  // Prefer somewhat central cards
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const centerDist =
    Math.hypot(cx - imgW / 2, cy - imgH / 2) / Math.hypot(imgW / 2, imgH / 2);
  const centerScore = clamp(1 - centerDist * 0.7, 0, 1);

  // Area sweet spot ~25–70%
  const areaScore =
    areaRatio < 0.25
      ? areaRatio / 0.25
      : areaRatio > 0.75
        ? clamp((0.95 - areaRatio) / 0.2, 0, 1)
        : 1;

  return (
    0.32 * aspectScore +
    0.28 * rectScore +
    0.22 * areaScore +
    0.18 * centerScore
  );
}

function drawScaled(
  bitmap: ImageBitmap,
  maxSide: number,
): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { canvas, scale };
}

function toGray(data: Uint8ClampedArray, n: number): Float32Array {
  const g = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return g;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src.slice();
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  // Horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let k = -r; k <= r; k++) {
        const xx = clamp(x + k, 0, w - 1);
        sum += src[y * w + xx];
        count++;
      }
      tmp[y * w + x] = sum / count;
    }
  }
  // Vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let k = -r; k <= r; k++) {
        const yy = clamp(y + k, 0, h - 1);
        sum += tmp[yy * w + x];
        count++;
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

function sobelMag(gray: Float32Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] +
        gray[i - w + 1] -
        2 * gray[i - 1] +
        2 * gray[i + 1] -
        gray[i + w - 1] +
        gray[i + w + 1];
      const gy =
        -gray[i - w - 1] -
        2 * gray[i - w] -
        gray[i - w + 1] +
        gray[i + w - 1] +
        2 * gray[i + w] +
        gray[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

/** Sample mean luminance of a corner patch (background estimate). */
function cornerMean(gray: Float32Array, w: number, h: number): number {
  const pw = Math.max(2, Math.floor(w * 0.08));
  const ph = Math.max(2, Math.floor(h * 0.08));
  const patches: Array<[number, number]> = [
    [0, 0],
    [w - pw, 0],
    [0, h - ph],
    [w - pw, h - ph],
  ];
  let sum = 0;
  let n = 0;
  for (const [ox, oy] of patches) {
    for (let y = oy; y < oy + ph; y++) {
      for (let x = ox; x < ox + pw; x++) {
        sum += gray[y * w + x];
        n++;
      }
    }
  }
  return sum / Math.max(1, n);
}

/**
 * Build a foreground mask: pixels far from border background OR on strong edges,
 * then keep the largest interior blob via flood-fill of background from borders.
 */
function buildCardMask(
  gray: Float32Array,
  edges: Float32Array,
  w: number,
  h: number,
): Uint8Array {
  const bg = cornerMean(gray, w, h);
  // Adaptive threshold from variance of corner vs whole
  let sum = 0;
  let sum2 = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    sum += gray[i];
    sum2 += gray[i] * gray[i];
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const colorThresh = Math.max(18, Math.min(48, std * 0.55));

  let edgeMax = 0;
  for (let i = 0; i < n; i++) if (edges[i] > edgeMax) edgeMax = edges[i];
  const edgeThresh = edgeMax * 0.18;

  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const colorDiff = Math.abs(gray[i] - bg);
    if (colorDiff > colorThresh || edges[i] > edgeThresh) fg[i] = 1;
  }

  // Dilate lightly to close gaps
  const dil = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (
        fg[i] ||
        fg[i - 1] ||
        fg[i + 1] ||
        fg[i - w] ||
        fg[i + w]
      ) {
        dil[i] = 1;
      }
    }
  }

  // Flood-fill background from image border through non-foreground
  const bgMask = new Uint8Array(n); // 1 = background
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bgMask[i] || dil[i]) return;
    bgMask[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  // Card candidate = not background
  const card = new Uint8Array(n);
  for (let i = 0; i < n; i++) card[i] = bgMask[i] ? 0 : 1;
  return card;
}

/** Extreme-point corners of a binary blob (classic document scanner heuristic). */
function blobToQuad(mask: Uint8Array, w: number, h: number): Quad | null {
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  let tl: Point | null = null;
  let br: Point | null = null;
  let tr: Point | null = null;
  let bl: Point | null = null;
  let count = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      const s = x + y;
      const d = x - y;
      if (s < minSum) {
        minSum = s;
        tl = { x, y };
      }
      if (s > maxSum) {
        maxSum = s;
        br = { x, y };
      }
      if (d > maxDiff) {
        maxDiff = d;
        tr = { x, y };
      }
      if (d < minDiff) {
        minDiff = d;
        bl = { x, y };
      }
    }
  }

  if (!tl || !tr || !br || !bl || count < (w * h) * MIN_AREA_RATIO) return null;

  // Reject degenerate quads (points too close)
  const q = orderQuad([tl, tr, br, bl]);
  const sides = sideLengths(q);
  if (Math.min(...sides) < Math.min(w, h) * 0.12) return null;
  return q;
}

/**
 * Also try an axis-aligned tight bounding box of the blob as a fallback candidate.
 */
function blobBoundsQuad(mask: Uint8Array, w: number, h: number): Quad | null {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (count < (w * h) * MIN_AREA_RATIO) return null;
  // Inset slightly to avoid soft edges
  const padX = Math.max(1, Math.round((maxX - minX) * 0.01));
  const padY = Math.max(1, Math.round((maxY - minY) * 0.01));
  minX = clamp(minX + padX, 0, w - 1);
  minY = clamp(minY + padY, 0, h - 1);
  maxX = clamp(maxX - padX, 0, w - 1);
  maxY = clamp(maxY - padY, 0, h - 1);
  if (maxX - minX < 10 || maxY - minY < 10) return null;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** Detect the dominant card quad in analysis coordinates. */
export function detectCardQuad(
  bitmap: ImageBitmap,
): { quad: Quad; scale: number; score: number } | null {
  const { canvas, scale } = drawScaled(bitmap, ANALYZE_MAX);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const gray = toGray(img.data, w * h);
  const blurred = boxBlur(gray, w, h, 1);
  const edges = sobelMag(blurred, w, h);
  const mask = buildCardMask(blurred, edges, w, h);

  const candidates: Quad[] = [];
  const extreme = blobToQuad(mask, w, h);
  if (extreme) candidates.push(extreme);
  const bounds = blobBoundsQuad(mask, w, h);
  if (bounds) candidates.push(bounds);

  let best: Quad | null = null;
  let bestScore = 0;
  for (const q of candidates) {
    const s = scoreQuad(q, w, h);
    if (s > bestScore) {
      bestScore = s;
      best = q;
    }
  }

  if (!best || bestScore < MIN_SCORE) return null;
  return { quad: best, scale, score: bestScore };
}

/** Solve 8×8 homography mapping src → dst (perspective). */
function getPerspectiveTransform(src: Quad, dst: Quad): Float64Array {
  // h = [a b c d e f g h] for
  // x' = (ax+by+c)/(gx+hy+1), y' = (dx+ey+f)/(gx+hy+1)
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const u = dst[i].x;
    const v = dst[i].y;
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  // Gaussian elimination
  const m = A.map((row, i) => [...row, b[i]]);
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    if (Math.abs(div) < 1e-12) continue;
    for (let c = col; c <= n; c++) m[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const h = new Float64Array(8);
  for (let i = 0; i < 8; i++) h[i] = m[i][8];
  return h;
}

function invertHomography(h: Float64Array): Float64Array | null {
  // Full 3×3 with h8=1
  const H = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
  const det =
    H[0][0] * (H[1][1] * H[2][2] - H[1][2] * H[2][1]) -
    H[0][1] * (H[1][0] * H[2][2] - H[1][2] * H[2][0]) +
    H[0][2] * (H[1][0] * H[2][1] - H[1][1] * H[2][0]);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    [
      (H[1][1] * H[2][2] - H[1][2] * H[2][1]) / det,
      (H[0][2] * H[2][1] - H[0][1] * H[2][2]) / det,
      (H[0][1] * H[1][2] - H[0][2] * H[1][1]) / det,
    ],
    [
      (H[1][2] * H[2][0] - H[1][0] * H[2][2]) / det,
      (H[0][0] * H[2][2] - H[0][2] * H[2][0]) / det,
      (H[0][2] * H[1][0] - H[0][0] * H[1][2]) / det,
    ],
    [
      (H[1][0] * H[2][1] - H[1][1] * H[2][0]) / det,
      (H[0][1] * H[2][0] - H[0][0] * H[2][1]) / det,
      (H[0][0] * H[1][1] - H[0][1] * H[1][0]) / det,
    ],
  ];
  // Normalize so inv[2][2] == 1
  const s = inv[2][2];
  if (Math.abs(s) < 1e-12) return null;
  return new Float64Array([
    inv[0][0] / s,
    inv[0][1] / s,
    inv[0][2] / s,
    inv[1][0] / s,
    inv[1][1] / s,
    inv[1][2] / s,
    inv[2][0] / s,
    inv[2][1] / s,
  ]);
}

function sampleBilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number] {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) {
    const xi = clamp(Math.round(x), 0, w - 1);
    const yi = clamp(Math.round(y), 0, h - 1);
    const i = (yi * w + xi) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + w * 4;
  const i11 = i01 + 4;
  const r =
    data[i00] * (1 - fx) * (1 - fy) +
    data[i10] * fx * (1 - fy) +
    data[i01] * (1 - fx) * fy +
    data[i11] * fx * fy;
  const g =
    data[i00 + 1] * (1 - fx) * (1 - fy) +
    data[i10 + 1] * fx * (1 - fy) +
    data[i01 + 1] * (1 - fx) * fy +
    data[i11 + 1] * fx * fy;
  const b =
    data[i00 + 2] * (1 - fx) * (1 - fy) +
    data[i10 + 2] * fx * (1 - fy) +
    data[i01 + 2] * (1 - fx) * fy +
    data[i11 + 2] * fx * fy;
  return [r, g, b];
}

/** Convenience: returns a canvas that drawImage accepts. */
export function warpCardToCanvas(
  bitmap: ImageBitmap,
  quad: Quad,
): HTMLCanvasElement | null {
  const [tl, tr, br, bl] = quad;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  const avgW = (top + bottom) / 2;
  const avgH = (left + right) / 2;
  const landscape = avgW >= avgH;
  const longSide = Math.max(avgW, avgH);
  const outLong = clamp(Math.round(longSide), 640, 1400);
  const outW = landscape ? outLong : Math.round(outLong / CARD_ASPECT);
  const outH = landscape ? Math.round(outLong / CARD_ASPECT) : outLong;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = bitmap.width;
  srcCanvas.height = bitmap.height;
  const sctx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(bitmap, 0, 0);
  const srcData = sctx.getImageData(0, 0, bitmap.width, bitmap.height);

  const dst: Quad = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];

  const H = getPerspectiveTransform(quad, dst);
  const inv = invertHomography(H);
  if (!inv) return null;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d");
  if (!octx) return null;
  const outImg = octx.createImageData(outW, outH);
  const od = outImg.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = inv[6] * x + inv[7] * y + 1;
      const sx = (inv[0] * x + inv[1] * y + inv[2]) / denom;
      const sy = (inv[3] * x + inv[4] * y + inv[5]) / denom;
      const [r, g, b] = sampleBilinear(
        srcData.data,
        bitmap.width,
        bitmap.height,
        sx,
        sy,
      );
      const i = (y * outW + x) * 4;
      od[i] = r;
      od[i + 1] = g;
      od[i + 2] = b;
      od[i + 3] = 255;
    }
  }
  octx.putImageData(outImg, 0, 0);
  return out;
}

export type CropAttempt = {
  /** Canvas or original bitmap ready to compress. */
  source: ImageBitmap | HTMLCanvasElement;
  cropped: boolean;
  /** True when we intentionally skipped / failed detection. */
  skipped: boolean;
};

/**
 * Detect the card, perspective-correct, and fit to ~3.5×2.
 * On weak detection, returns the original bitmap unchanged (never throws for soft fails).
 */
export async function cropBusinessCard(bitmap: ImageBitmap): Promise<CropAttempt> {
  try {
    const detected = detectCardQuad(bitmap);
    if (!detected) {
      return { source: bitmap, cropped: false, skipped: true };
    }

    // Map analysis-space quad → full-resolution
    const { quad, scale } = detected;
    const full: Quad = orderQuad(
      quad.map((p) => ({ x: p.x / scale, y: p.y / scale })),
    );

    const warped = warpCardToCanvas(bitmap, full);
    if (!warped) {
      return { source: bitmap, cropped: false, skipped: true };
    }
    return { source: warped, cropped: true, skipped: false };
  } catch {
    return { source: bitmap, cropped: false, skipped: true };
  }
}
