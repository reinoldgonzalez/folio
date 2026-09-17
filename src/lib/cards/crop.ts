/** Client-side business-card region detection + perspective warp (no OpenCV). */

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // TL, TR, BR, BL

/** Standard US business card aspect (3.5 × 2). */
export const CARD_ASPECT = 3.5 / 2;

const ANALYZE_MAX = 420;
const MIN_AREA_RATIO = 0.06;
const MAX_AREA_RATIO = 0.95;
/** Accept imperfect quads that still beat a full-frame keep. */
const WEAK_SCORE = 0.18;

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
  const aspectErr = Math.min(
    Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT,
    Math.abs(aspect - 1 / CARD_ASPECT) / (1 / CARD_ASPECT),
    Math.abs(aspect - 1.4) / 1.4,
    Math.abs(aspect - 1.6) / 1.6,
  );
  const aspectScore = clamp(1 - aspectErr * 1.15, 0, 1);

  const oppW = 1 - Math.abs(top - bottom) / Math.max(top, bottom, 1);
  const oppH = 1 - Math.abs(left - right) / Math.max(left, right, 1);
  const rectScore = (oppW + oppH) / 2;

  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const centerDist =
    Math.hypot(cx - imgW / 2, cy - imgH / 2) / Math.hypot(imgW / 2, imgH / 2);
  const centerScore = clamp(1 - centerDist * 0.55, 0, 1);

  // Prefer mid-size crops; still reward large-ish cards that aren't full-bleed
  const areaScore =
    areaRatio < 0.18
      ? areaRatio / 0.18
      : areaRatio > 0.82
        ? clamp((0.98 - areaRatio) / 0.16, 0, 1)
        : 1;

  return (
    0.34 * aspectScore +
    0.26 * rectScore +
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

type Rgb = { r: number; g: number; b: number };

function sampleBorderColors(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): Rgb {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  };
  for (let x = 0; x < w; x += step) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    add(0, y);
    add(w - 1, y);
  }
  // Prefer corner patches when border is contaminated by the card
  const pw = Math.max(2, Math.floor(w * 0.06));
  const ph = Math.max(2, Math.floor(h * 0.06));
  const corners: Array<[number, number]> = [
    [0, 0],
    [w - pw, 0],
    [0, h - ph],
    [w - pw, h - ph],
  ];
  let cr = 0;
  let cg = 0;
  let cb = 0;
  let cn = 0;
  for (const [ox, oy] of corners) {
    for (let y = oy; y < oy + ph; y += step) {
      for (let x = ox; x < ox + pw; x += step) {
        const i = (y * w + x) * 4;
        cr += data[i];
        cg += data[i + 1];
        cb += data[i + 2];
        cn++;
      }
    }
  }
  // Blend: corners weigh more (desk corners usually background)
  const tw = n + cn * 2;
  return {
    r: (r + cr * 2) / tw,
    g: (g + cg * 2) / tw,
    b: (b + cb * 2) / tw,
  };
}

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

function grayStats(gray: Float32Array): { mean: number; std: number } {
  let sum = 0;
  let sum2 = 0;
  const n = gray.length;
  for (let i = 0; i < n; i++) {
    sum += gray[i];
    sum2 += gray[i] * gray[i];
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { mean, std };
}

/** Otsu threshold on downsampled histogram. */
function otsuThreshold(gray: Float32Array): number {
  const hist = new Float32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[clamp(Math.round(gray[i]), 0, 255)]++;
  }
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

function dilate(src: Uint8Array, w: number, h: number, passes = 1): Uint8Array {
  let cur = src;
  for (let p = 0; p < passes; p++) {
    const out = new Uint8Array(cur.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (
          cur[i] ||
          cur[i - 1] ||
          cur[i + 1] ||
          cur[i - w] ||
          cur[i + w]
        ) {
          out[i] = 1;
        }
      }
    }
    cur = out;
  }
  return cur;
}

function erode(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (
        src[i] &&
        src[i - 1] &&
        src[i + 1] &&
        src[i - w] &&
        src[i + w]
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/**
 * Flood-fill background from image border through non-foreground pixels.
 * Returns card candidate mask (1 = foreground / not reachable background).
 */
function borderFloodCard(
  fg: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  const n = w * h;
  const bgMask = new Uint8Array(n);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bgMask[i] || fg[i]) return;
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
  const card = new Uint8Array(n);
  for (let i = 0; i < n; i++) card[i] = bgMask[i] ? 0 : 1;
  return card;
}

/** Keep only the largest 4-connected component in a binary mask. */
function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const seen = new Uint8Array(n);
  const out = new Uint8Array(n);
  let bestStart = -1;
  let bestSize = 0;
  const stack: number[] = [];

  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    let size = 0;
    const start = i;
    while (stack.length) {
      const cur = stack.pop()!;
      size++;
      const x = cur % w;
      const y = (cur / w) | 0;
      const nbrs = [cur - 1, cur + 1, cur - w, cur + w];
      for (const nb of nbrs) {
        if (nb < 0 || nb >= n) continue;
        const nx = nb % w;
        const ny = (nb / w) | 0;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        if (!mask[nb] || seen[nb]) continue;
        seen[nb] = 1;
        stack.push(nb);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestStart = start;
    }
  }

  if (bestStart < 0 || bestSize < n * MIN_AREA_RATIO * 0.5) return out;

  // Refill best component
  stack.length = 0;
  stack.push(bestStart);
  out[bestStart] = 1;
  const filled = new Uint8Array(n);
  filled[bestStart] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    const x = cur % w;
    const y = (cur / w) | 0;
    const nbrs = [cur - 1, cur + 1, cur - w, cur + w];
    for (const nb of nbrs) {
      if (nb < 0 || nb >= n) continue;
      const nx = nb % w;
      const ny = (nb / w) | 0;
      if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
      if (!mask[nb] || filled[nb]) continue;
      filled[nb] = 1;
      out[nb] = 1;
      stack.push(nb);
    }
  }
  return out;
}

function maskFromColorDiff(
  gray: Float32Array,
  edges: Float32Array,
  w: number,
  h: number,
  colorThresh: number,
  edgeFrac: number,
): Uint8Array {
  const bg = cornerMean(gray, w, h);
  const n = w * h;
  let edgeMax = 0;
  for (let i = 0; i < n; i++) if (edges[i] > edgeMax) edgeMax = edges[i];
  const edgeThresh = edgeMax * edgeFrac;
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Math.abs(gray[i] - bg) > colorThresh || edges[i] > edgeThresh) fg[i] = 1;
  }
  return borderFloodCard(dilate(fg, w, h, 1), w, h);
}

function maskFromRgbDistance(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  thresh: number,
): Uint8Array {
  const bg = sampleBorderColors(data, w, h);
  const n = w * h;
  const fg = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const dr = data[p] - bg.r;
    const dg = data[p + 1] - bg.g;
    const db = data[p + 2] - bg.b;
    if (Math.hypot(dr, dg, db) > thresh) fg[i] = 1;
  }
  return borderFloodCard(dilate(fg, w, h, 1), w, h);
}

function maskFromOtsu(
  gray: Float32Array,
  w: number,
  h: number,
  preferBright: boolean,
): Uint8Array {
  const t = otsuThreshold(gray);
  const n = w * h;
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    fg[i] = preferBright ? (gray[i] >= t ? 1 : 0) : gray[i] < t ? 1 : 0;
  }
  // Cards rarely touch every border; flood from border through non-fg
  const card = borderFloodCard(dilate(fg, w, h, 1), w, h);
  // If flood left almost everything, fall back to largest component of raw fg
  let count = 0;
  for (let i = 0; i < n; i++) if (card[i]) count++;
  if (count > n * 0.92 || count < n * MIN_AREA_RATIO) {
    return largestComponent(erode(dilate(fg, w, h, 2), w, h), w, h);
  }
  return largestComponent(card, w, h);
}

function maskFromEdges(
  edges: Float32Array,
  w: number,
  h: number,
  edgeFrac: number,
): Uint8Array {
  const n = w * h;
  let edgeMax = 0;
  for (let i = 0; i < n; i++) if (edges[i] > edgeMax) edgeMax = edges[i];
  const thresh = Math.max(12, edgeMax * edgeFrac);
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (edges[i] > thresh) fg[i] = 1;
  // Close edge gaps then flood exterior
  const closed = dilate(fg, w, h, 2);
  return borderFloodCard(closed, w, h);
}

/**
 * Bright / high-contrast axis-aligned rectangle via integral-image-ish scan
 * of local difference from border mean — find best window near card aspect.
 */
function brightRectQuad(
  gray: Float32Array,
  w: number,
  h: number,
): Quad | null {
  const bg = cornerMean(gray, w, h);
  // Downsample grid for speed
  const step = Math.max(2, Math.floor(Math.min(w, h) / 60));
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const cell = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * step;
      const y0 = gy * step;
      const x1 = Math.min(w, x0 + step);
      const y1 = Math.min(h, y0 + step);
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += Math.abs(gray[y * w + x] - bg);
          n++;
        }
      }
      cell[gy * gw + gx] = sum / Math.max(1, n);
    }
  }

  // Integral image
  const integ = new Float32Array((gw + 1) * (gh + 1));
  for (let y = 1; y <= gh; y++) {
    let row = 0;
    for (let x = 1; x <= gw; x++) {
      row += cell[(y - 1) * gw + (x - 1)];
      integ[y * (gw + 1) + x] = integ[(y - 1) * (gw + 1) + x] + row;
    }
  }
  const rectSum = (x0: number, y0: number, x1: number, y1: number) => {
    // inclusive grid cells [x0,x1) [y0,y1)
    return (
      integ[y1 * (gw + 1) + x1] -
      integ[y0 * (gw + 1) + x1] -
      integ[y1 * (gw + 1) + x0] +
      integ[y0 * (gw + 1) + x0]
    );
  };

  let bestScore = 0;
  let best: Quad | null = null;
  const aspects = [CARD_ASPECT, 1 / CARD_ASPECT, 1.5, 1 / 1.5];

  for (const aspect of aspects) {
    for (let hh = Math.max(4, Math.floor(gh * 0.25)); hh <= Math.floor(gh * 0.9); hh++) {
      const ww = Math.round(hh * aspect);
      if (ww < 4 || ww > gw) continue;
      for (let y0 = 0; y0 + hh <= gh; y0++) {
        for (let x0 = 0; x0 + ww <= gw; x0++) {
          const area = ww * hh;
          const mean = rectSum(x0, y0, x0 + ww, y0 + hh) / area;
          // Prefer contrasty interiors that aren't tiny
          const areaFrac = area / (gw * gh);
          const s = mean * (0.6 + 0.4 * clamp(areaFrac / 0.35, 0, 1));
          if (s > bestScore) {
            bestScore = s;
            const minX = x0 * step;
            const minY = y0 * step;
            const maxX = Math.min(w - 1, (x0 + ww) * step - 1);
            const maxY = Math.min(h - 1, (y0 + hh) * step - 1);
            best = [
              { x: minX, y: minY },
              { x: maxX, y: minY },
              { x: maxX, y: maxY },
              { x: minX, y: maxY },
            ];
          }
        }
      }
    }
  }
  return best;
}

/** Extreme-point corners of a binary blob. */
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

  if (!tl || !tr || !br || !bl || count < w * h * MIN_AREA_RATIO) return null;

  const q = orderQuad([tl, tr, br, bl]);
  const sides = sideLengths(q);
  if (Math.min(...sides) < Math.min(w, h) * 0.08) return null;
  return q;
}

/** Axis-aligned tight bounding box of the blob. */
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
  if (count < w * h * MIN_AREA_RATIO) return null;
  const padX = Math.max(1, Math.round((maxX - minX) * 0.012));
  const padY = Math.max(1, Math.round((maxY - minY) * 0.012));
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

/**
 * Fit an axis-aligned bbox to card aspect (letterbox crop inside the bbox),
 * then return as a quad — used when extreme-point quads are weak.
 */
function fitBoundsToCardAspect(bounds: Quad, imgW: number, imgH: number): Quad {
  const minX = Math.min(bounds[0].x, bounds[3].x);
  const maxX = Math.max(bounds[1].x, bounds[2].x);
  const minY = Math.min(bounds[0].y, bounds[1].y);
  const maxY = Math.max(bounds[2].y, bounds[3].y);
  let bw = maxX - minX;
  let bh = maxY - minY;
  if (bw < 8 || bh < 8) return bounds;

  const landscape = bw >= bh;
  const target = landscape ? CARD_ASPECT : 1 / CARD_ASPECT;
  const cur = bw / bh;
  let x0 = minX;
  let y0 = minY;
  let x1 = maxX;
  let y1 = maxY;

  if (cur > target * 1.08) {
    // Too wide — shrink width around center
    const newW = bh * target;
    const cx = (minX + maxX) / 2;
    x0 = cx - newW / 2;
    x1 = cx + newW / 2;
  } else if (cur < target / 1.08) {
    const newH = bw / target;
    const cy = (minY + maxY) / 2;
    y0 = cy - newH / 2;
    y1 = cy + newH / 2;
  }

  x0 = clamp(x0, 0, imgW - 1);
  y0 = clamp(y0, 0, imgH - 1);
  x1 = clamp(x1, 0, imgW - 1);
  y1 = clamp(y1, 0, imgH - 1);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Largest centered card-aspect rectangle with a small inset. */
export function centerCardAspectQuad(
  imgW: number,
  imgH: number,
  insetFrac = 0.06,
): Quad {
  const insetX = imgW * insetFrac;
  const insetY = imgH * insetFrac;
  const availW = imgW - 2 * insetX;
  const availH = imgH - 2 * insetY;
  const frameAspect = availW / availH;
  let cropW: number;
  let cropH: number;
  // Prefer landscape 3.5:2 when frame is wider; portrait otherwise
  if (frameAspect >= 1) {
    // Try landscape card in frame
    if (frameAspect >= CARD_ASPECT) {
      cropH = availH;
      cropW = cropH * CARD_ASPECT;
    } else {
      cropW = availW;
      cropH = cropW / CARD_ASPECT;
    }
  } else {
    // Portrait frame — portrait card (2:3.5)
    const portrait = 1 / CARD_ASPECT;
    if (frameAspect <= portrait) {
      cropW = availW;
      cropH = cropW / portrait;
    } else {
      cropH = availH;
      cropW = cropH * portrait;
    }
  }
  const x0 = (imgW - cropW) / 2;
  const y0 = (imgH - cropH) / 2;
  return [
    { x: x0, y: y0 },
    { x: x0 + cropW, y: y0 },
    { x: x0 + cropW, y: y0 + cropH },
    { x: x0, y: y0 + cropH },
  ];
}

function consider(
  candidates: Array<{ quad: Quad; score: number; kind: string }>,
  q: Quad | null,
  w: number,
  h: number,
  kind: string,
  boost = 0,
) {
  if (!q) return;
  const s = scoreQuad(q, w, h) + boost;
  if (s > 0) candidates.push({ quad: q, score: s, kind });
}

/** Detect the dominant card quad in analysis coordinates. */
export function detectCardQuad(
  bitmap: ImageBitmap,
): { quad: Quad; scale: number; score: number; kind: string } | null {
  const { canvas, scale } = drawScaled(bitmap, ANALYZE_MAX);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const gray = toGray(img.data, w * h);
  const blurred = boxBlur(gray, w, h, 1);
  const edges = sobelMag(blurred, w, h);
  const { std } = grayStats(blurred);

  const candidates: Array<{ quad: Quad; score: number; kind: string }> = [];

  // Pair a few adaptive + fixed thresholds (avoid O(thresholds×edges) blowup on phone).
  const colorPasses: Array<[number, number]> = [
    [Math.max(12, Math.min(28, std * 0.35)), 0.14],
    [Math.max(16, Math.min(42, std * 0.55)), 0.2],
    [Math.max(22, Math.min(55, std * 0.75)), 0.28],
    [14, 0.18],
    [36, 0.16],
  ];

  for (const [ct, ef] of colorPasses) {
    const mask = maskFromColorDiff(blurred, edges, w, h, ct, ef);
    const big = largestComponent(mask, w, h);
    consider(candidates, blobToQuad(big, w, h), w, h, "color-extreme");
    const bounds = blobBoundsQuad(big, w, h);
    consider(candidates, bounds, w, h, "color-bounds");
    if (bounds) {
      consider(
        candidates,
        fitBoundsToCardAspect(bounds, w, h),
        w,
        h,
        "color-fit",
        0.02,
      );
    }
  }

  for (const thresh of [30, 48, 70]) {
    const mask = maskFromRgbDistance(img.data, w, h, thresh);
    const big = largestComponent(mask, w, h);
    consider(candidates, blobToQuad(big, w, h), w, h, "rgb-extreme");
    const bounds = blobBoundsQuad(big, w, h);
    consider(candidates, bounds, w, h, "rgb-bounds");
    if (bounds) {
      consider(
        candidates,
        fitBoundsToCardAspect(bounds, w, h),
        w,
        h,
        "rgb-fit",
        0.02,
      );
    }
  }

  for (const bright of [true, false]) {
    const mask = maskFromOtsu(blurred, w, h, bright);
    consider(candidates, blobToQuad(mask, w, h), w, h, "otsu-extreme");
    const bounds = blobBoundsQuad(mask, w, h);
    consider(candidates, bounds, w, h, "otsu-bounds");
    if (bounds) {
      consider(
        candidates,
        fitBoundsToCardAspect(bounds, w, h),
        w,
        h,
        "otsu-fit",
        0.015,
      );
    }
  }

  for (const ef of [0.16, 0.26]) {
    const mask = maskFromEdges(edges, w, h, ef);
    const big = largestComponent(mask, w, h);
    consider(candidates, blobToQuad(big, w, h), w, h, "edge-extreme");
    const bounds = blobBoundsQuad(big, w, h);
    consider(candidates, bounds, w, h, "edge-bounds");
  }

  const brightQ = brightRectQuad(blurred, w, h);
  consider(candidates, brightQ, w, h, "bright-rect", 0.01);

  let best: (typeof candidates)[0] | null = null;
  for (const c of candidates) {
    if (!best || c.score > best.score) best = c;
  }

  if (!best || best.score < WEAK_SCORE) return null;
  return { quad: best.quad, scale, score: best.score, kind: best.kind };
}

/** Solve 8×8 homography mapping src → dst (perspective). */
function getPerspectiveTransform(src: Quad, dst: Quad): Float64Array {
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

/** Cap warped output longest side — keeps RGBA buffers phone-safe. */
const WARP_OUT_MAX = 1000;
/** Never sample perspective warp from a canvas larger than this. */
const WARP_SRC_MAX = 1600;

function releaseCanvas(canvas: HTMLCanvasElement) {
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // ignore
  }
}

function isAxisAligned(q: Quad, tol = 2.5): boolean {
  const nearly = (a: number, b: number) => Math.abs(a - b) <= tol;
  return (
    nearly(q[0].y, q[1].y) &&
    nearly(q[3].y, q[2].y) &&
    nearly(q[0].x, q[3].x) &&
    nearly(q[1].x, q[2].x)
  );
}

function outputSizeForQuad(quad: Quad): { outW: number; outH: number } {
  const [tl, tr, br, bl] = quad;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  const avgW = (top + bottom) / 2;
  const avgH = (left + right) / 2;
  const landscape = avgW >= avgH;
  const longSide = Math.max(avgW, avgH);
  const outLong = clamp(Math.round(longSide), 640, WARP_OUT_MAX);
  const outW = landscape ? outLong : Math.round(outLong / CARD_ASPECT);
  const outH = landscape ? Math.round(outLong / CARD_ASPECT) : outLong;
  return { outW, outH };
}

/** Cheap axis-aligned crop via drawImage — no getImageData. */
function warpAxisAligned(
  bitmap: ImageBitmap,
  quad: Quad,
  outW: number,
  outH: number,
): HTMLCanvasElement | null {
  const minX = Math.min(quad[0].x, quad[1].x, quad[2].x, quad[3].x);
  const maxX = Math.max(quad[0].x, quad[1].x, quad[2].x, quad[3].x);
  const minY = Math.min(quad[0].y, quad[1].y, quad[2].y, quad[3].y);
  const maxY = Math.max(quad[0].y, quad[1].y, quad[2].y, quad[3].y);
  const sw = maxX - minX;
  const sh = maxY - minY;
  if (sw < 4 || sh < 4) return null;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#f4eee4";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(bitmap, minX, minY, sw, sh, 0, 0, outW, outH);
  return out;
}

/**
 * Perspective warp sampling only from an already-downscaled source canvas.
 * Never getImageData at native camera resolution.
 */
function warpPerspective(
  bitmap: ImageBitmap,
  quad: Quad,
  outW: number,
  outH: number,
): HTMLCanvasElement | null {
  const srcScale = Math.min(
    1,
    WARP_SRC_MAX / Math.max(bitmap.width, bitmap.height),
  );
  const srcW = Math.max(1, Math.round(bitmap.width * srcScale));
  const srcH = Math.max(1, Math.round(bitmap.height * srcScale));

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const sctx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(bitmap, 0, 0, srcW, srcH);
  const srcData = sctx.getImageData(0, 0, srcW, srcH);
  // Free GPU/backing store; pixels live in srcData now
  releaseCanvas(srcCanvas);

  const scaledQuad: Quad = orderQuad(
    quad.map((p) => ({ x: p.x * srcScale, y: p.y * srcScale })),
  );

  const dst: Quad = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];

  const H = getPerspectiveTransform(scaledQuad, dst);
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
      const [r, g, b] = sampleBilinear(srcData.data, srcW, srcH, sx, sy);
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

/** Convenience: returns a canvas that drawImage accepts. */
export function warpCardToCanvas(
  bitmap: ImageBitmap,
  quad: Quad,
): HTMLCanvasElement | null {
  const { outW, outH } = outputSizeForQuad(quad);

  // Prefer drawImage for axis-aligned quads (center-fit / bounds) — no ImageData.
  if (isAxisAligned(quad)) {
    try {
      const simple = warpAxisAligned(bitmap, quad, outW, outH);
      if (simple) return simple;
    } catch {
      // fall through to perspective / fail
    }
  }

  try {
    return warpPerspective(bitmap, quad, outW, outH);
  } catch {
    // OOM mid-warp: try a cheap axis-aligned bbox draw as last resort
    try {
      return warpAxisAligned(bitmap, quad, outW, outH);
    } catch {
      return null;
    }
  }
}

export type CropAttempt = {
  /** Canvas or original bitmap ready to compress. */
  source: ImageBitmap | HTMLCanvasElement;
  /** True when a card region was isolated (detection or center fit). */
  cropped: boolean;
  /** True when we used the centered card-aspect fallback (not a detected quad). */
  fitted: boolean;
  /** True only when we kept the unchanged full frame. */
  skipped: boolean;
};

/** Simple downscale of the working bitmap when warp/crop OOM. */
function simpleDownscaleCanvas(
  bitmap: ImageBitmap,
  maxSide = WARP_OUT_MAX,
): HTMLCanvasElement | null {
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Detect the card, perspective-correct, and fit to ~3.5×2.
 * Falls back to bbox fit, then center card-aspect crop — almost never leaves
 * the full uncropped photo. On OOM, prefers a cheap downscale over crashing.
 */
export async function cropBusinessCard(bitmap: ImageBitmap): Promise<CropAttempt> {
  try {
    const detected = detectCardQuad(bitmap);
    if (detected && detected.score >= WEAK_SCORE) {
      const { quad, scale } = detected;
      const full: Quad = orderQuad(
        quad.map((p) => ({ x: p.x / scale, y: p.y / scale })),
      );
      try {
        const warped = warpCardToCanvas(bitmap, full);
        if (warped) {
          return {
            source: warped,
            cropped: true,
            fitted: false,
            skipped: false,
          };
        }
      } catch {
        // warp OOM — try center fit below
      }
    }

    // Fallback B: center card-aspect crop → warp/fit to 3.5×2 output
    try {
      const center = centerCardAspectQuad(bitmap.width, bitmap.height, 0.06);
      const fittedCanvas = warpCardToCanvas(bitmap, center);
      if (fittedCanvas) {
        return {
          source: fittedCanvas,
          cropped: true,
          fitted: true,
          skipped: false,
        };
      }
    } catch {
      // fall through
    }

    // Fallback C: cheap downscale so encode still succeeds
    const down = simpleDownscaleCanvas(bitmap);
    if (down) {
      return { source: down, cropped: false, fitted: false, skipped: true };
    }

    return { source: bitmap, cropped: false, fitted: false, skipped: true };
  } catch {
    try {
      const center = centerCardAspectQuad(bitmap.width, bitmap.height, 0.06);
      const fittedCanvas = warpCardToCanvas(bitmap, center);
      if (fittedCanvas) {
        return {
          source: fittedCanvas,
          cropped: true,
          fitted: true,
          skipped: false,
        };
      }
    } catch {
      // ignore
    }
    const down = simpleDownscaleCanvas(bitmap);
    if (down) {
      return { source: down, cropped: false, fitted: false, skipped: true };
    }
    return { source: bitmap, cropped: false, fitted: false, skipped: true };
  }
}
