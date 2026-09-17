/** Working-copy longest side after load (compress never sees native MP). */
const WORK_MAX = 1600;
/** Stricter cap for very large phone photos (e.g. 12MP+). */
const WORK_MAX_HUGE = 1280;
const HUGE_LONGEST = 3500;

export type CompressPurpose = "storage" | "ocr";

type CompressTuning = {
  startQuality: number;
  minQuality: number;
  maxWidth: number;
  maxChars: number;
  floorWidth: number;
};

const TUNING: Record<CompressPurpose, CompressTuning> = {
  // Small enough for localStorage / many cards
  storage: {
    startQuality: 0.74,
    minQuality: 0.44,
    maxWidth: 1200,
    maxChars: 180_000,
    floorWidth: 640,
  },
  // Sharper working crop for Tesseract — still bounded for phone RAM
  ocr: {
    startQuality: 0.9,
    minQuality: 0.72,
    maxWidth: 1600,
    maxChars: 700_000,
    floorWidth: 1000,
  },
};

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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
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
    const resized = await createImageBitmap(full, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: "high",
    });
    full.close();
    return resized;
  } catch {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return full;
      }
      ctx.drawImage(full, 0, 0, w, h);
      full.close();
      try {
        return await createImageBitmap(canvas);
      } catch {
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

/** Compress a captured photo into a JPEG data URL. */
export async function compressImage(
  source: ImageBitmap | HTMLCanvasElement,
  purpose: CompressPurpose = "storage",
): Promise<string> {
  const { width, height } = sourceSize(source);
  const tune = TUNING[purpose];
  let quality = tune.startQuality;
  let maxWidth = tune.maxWidth;
  let dataUrl = encode(source, width, height, maxWidth, quality);

  while (dataUrl.length > tune.maxChars && quality > tune.minQuality) {
    quality -= 0.08;
    dataUrl = encode(source, width, height, maxWidth, quality);
  }
  while (dataUrl.length > tune.maxChars && maxWidth > tune.floorWidth) {
    maxWidth -= 160;
    dataUrl = encode(source, width, height, maxWidth, tune.minQuality);
  }

  return dataUrl;
}

/**
 * Re-encode an existing data URL for long-term storage (after OCR is done).
 */
export async function compressDataUrlForStorage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  // Already small enough — skip re-encode
  if (dataUrl.length <= TUNING.storage.maxChars) return dataUrl;

  const blob = await (await fetch(dataUrl)).blob();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return dataUrl;
  }
  try {
    return await compressImage(bitmap, "storage");
  } catch {
    return dataUrl;
  } finally {
    try {
      bitmap.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Load → downscale for OOM safety → JPEG compress.
 * Default purpose is OCR-quality working copy (crop/read); persist via storage compress.
 */
export async function fileToCompressedDataUrl(
  file: File,
  purpose: CompressPurpose = "ocr",
): Promise<string> {
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

  try {
    try {
      return await compressImage(bitmap, purpose);
    } catch {
      return encode(bitmap, bitmap.width, bitmap.height, purpose === "ocr" ? 1200 : 800, 0.5);
    }
  } finally {
    try {
      bitmap.close();
    } catch {
      // ignore
    }
  }
}
