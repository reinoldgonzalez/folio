function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

function encode(
  bitmap: ImageBitmap,
  maxWidth: number,
  quality: number,
): string {
  const scale = Math.min(1, maxWidth / Math.max(bitmap.width, 1));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read this photo");
  ctx.fillStyle = "#f4eee4";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Compress a captured photo into a JPEG data URL small enough for localStorage. */
export async function compressImage(blob: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await loadBitmap(blob);
  } catch {
    throw new Error("That photo format is not supported. Try a JPEG or PNG.");
  }

  let quality = 0.74;
  let maxWidth = 1200;
  let dataUrl = encode(bitmap, maxWidth, quality);

  while (dataUrl.length > 180_000 && quality > 0.44) {
    quality -= 0.1;
    dataUrl = encode(bitmap, maxWidth, quality);
  }
  while (dataUrl.length > 180_000 && maxWidth > 640) {
    maxWidth -= 160;
    dataUrl = encode(bitmap, maxWidth, 0.5);
  }

  bitmap.close();
  return dataUrl;
}

export async function fileToCompressedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error("Please choose a photo of the card.");
  }
  return compressImage(file);
}
