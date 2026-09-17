import { cropBusinessCard } from "./crop";
import { enhanceClarity } from "./clarity";

function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

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

export type CompressedPhoto = {
  dataUrl: string;
  /** True when the card region was isolated and perspective-corrected. */
  cropped: boolean;
  /** True when a soft-shot clarity pass was applied. */
  sharpened: boolean;
  /** True when crop detection was weak and we kept the full frame. */
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
 * Load → crop card (best effort) → clarity if soft → JPEG compress.
 * Never blocks capture on crop/clarity failure.
 */
export async function fileToCompressedDataUrl(file: File): Promise<CompressedPhoto> {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error("Please choose a photo of the card.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    throw new Error("That photo format is not supported. Try a JPEG or PNG.");
  }

  let cropped = false;
  let cropSkipped = false;
  let sharpened = false;
  let working: ImageBitmap | HTMLCanvasElement = bitmap;

  try {
    const crop = await cropBusinessCard(bitmap);
    working = crop.source;
    cropped = crop.cropped;
    cropSkipped = crop.skipped;
  } catch {
    working = bitmap;
    cropSkipped = true;
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
    return { dataUrl, cropped, sharpened, cropSkipped };
  } finally {
    bitmap.close();
  }
}
