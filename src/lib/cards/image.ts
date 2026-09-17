import { cropBusinessCard } from "./crop";
import { enhanceClarity } from "./clarity";

/** Working-copy longest side after load (crop/clarity/compress never see native MP). */
const WORK_MAX = 1600;
/** Stricter cap for very large phone photos (e.g. 12MP+). */
const WORK_MAX_HUGE = 1280;
const HUGE_LONGEST = 3500;

function encode(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxWidth: number,
  quality: number,
): string {
  const scale = Math.min(1, maxWidth / Math.max(srcW, 1));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read this photo");
  ctx.fillStyle = "#f4eee4";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function sourceSize(source: ImageBitmap | HTMLCanvasElement): {
  width: number;
  height: number;
} {
  return { width: source.width, height: source.height };
}

/**
 * Load the photo and immediately downscale so longest side ≤ WORK_MAX
 * (or WORK_MAX_HUGE for very large images). Closes the native bitmap ASAP.
 */
async function loadWorkingBitmap(blob: Blob): Promise<ImageBitmap> {
  let full: ImageBitmap;
  try {
    full = await createImageBitmap(blob);
  } catch {
    throw new Error("That photo format is not supported. Try a JPEG or PNG.");
  }

  const longest = Math.max(full.width, full.height);
  const cap = longest > HUGE_LONGEST ? WORK_MAX_HUGE : WORK_MAX;

  if (longest <= cap) {
    return full;
  }

  const scale = cap / longest;
  const w = Math.max(1, Math.round(full.width * scale));
  const h = Math.max(1, Math.round(full.height * scale));

  try {
    // Preferred: browser-native resize from the already-decoded bitmap
    const resized = await createImageBitmap(full, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: "high",
    });
    full.close();
    return resized;
  } catch {
    // Fallback: canvas redraw then ImageBitmap from canvas
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return full; // keep full if we cannot resize (rare)
      }
      ctx.drawImage(full, 0, 0, w, h);
      full.close();
      try {
        return await createImageBitmap(canvas);
      } catch {
        // Last resort: re-decode from blob with resize options
        try {
          return await createImageBitmap(blob, {
            resizeWidth: w,
            resizeHeight: h,
            resizeQuality: "high",
          });
        } catch {
          return await createImageBitmap(blob);
        }
      }
    } catch {
      return full;
    }
  }
}

export type CompressedPhoto = {
  dataUrl: string;
  /** True when the card region was isolated and perspective-corrected. */
  cropped: boolean;
  /** True when we used a centered card-aspect fit (no strong quad). */
  fitted: boolean;
  /** True when a soft-shot clarity pass was applied. */
  sharpened: boolean;
  /** True when crop failed and we kept the unchanged full frame. */
  cropSkipped: boolean;
};

/** Compress a captured photo into a JPEG data URL small enough for localStorage. */
export async function compressImage(
  source: ImageBitmap | HTMLCanvasElement,
): Promise<string> {
  const { width, height } = sourceSize(source);
  let quality = 0.74;
  let maxWidth = 1200;
  let dataUrl = encode(source, width, height, maxWidth, quality);

  while (dataUrl.length > 180_000 && quality > 0.44) {
    quality -= 0.1;
    dataUrl = encode(source, width, height, maxWidth, quality);
  }
  while (dataUrl.length > 180_000 && maxWidth > 640) {
    maxWidth -= 160;
    dataUrl = encode(source, width, height, maxWidth, 0.5);
  }

  return dataUrl;
}

/**
 * Load → downscale → crop card (best effort) → clarity if soft → JPEG compress.
 * Never blocks capture on crop/clarity/OOM failure — prefers a fitted/compressed
 * photo over crashing with “low memory”.
 */
export async function fileToCompressedDataUrl(file: File): Promise<CompressedPhoto> {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error("Please choose a photo of the card.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await loadWorkingBitmap(file);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("That photo format is not supported. Try a JPEG or PNG.");
  }

  let cropped = false;
  let fitted = false;
  let cropSkipped = false;
  let sharpened = false;
  let working: ImageBitmap | HTMLCanvasElement = bitmap;

  try {
    try {
      const crop = await cropBusinessCard(bitmap);
      working = crop.source;
      cropped = crop.cropped;
      fitted = crop.fitted;
      cropSkipped = crop.skipped;
    } catch {
      working = bitmap;
      cropSkipped = true;
      cropped = false;
      fitted = false;
    }

    try {
      const clarity = enhanceClarity(working);
      working = clarity.source;
      sharpened = clarity.sharpened;
    } catch {
      // keep working as-is
    }

    try {
      const dataUrl = await compressImage(working);
      return { dataUrl, cropped, fitted, sharpened, cropSkipped };
    } catch {
      // OOM / encode failure: last-resort simple JPEG of the working bitmap
      const dataUrl = await compressImage(bitmap);
      return {
        dataUrl,
        cropped: false,
        fitted: false,
        sharpened: false,
        cropSkipped: true,
      };
    }
  } finally {
    try {
      bitmap.close();
    } catch {
      // ignore
    }
  }
}
