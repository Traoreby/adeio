export type ImageCrop = { aspect: "square" | "portrait" | "original"; x: number; y: number };

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImageUpload(
  source: File,
  crop: ImageCrop,
  maxSide: number,
  maxBytes: number,
  targetBytes: number,
) {
  const bitmap = await createImageBitmap(source);
  try {
    const sourceAspect = bitmap.width / bitmap.height;
    const targetAspect = crop.aspect === "square" ? 1 : crop.aspect === "portrait" ? 4 / 5 : sourceAspect;
    let cropWidth = bitmap.width;
    let cropHeight = bitmap.height;
    if (sourceAspect > targetAspect) cropWidth = bitmap.height * targetAspect;
    else cropHeight = bitmap.width / targetAspect;
    const sx = (bitmap.width - cropWidth) * Math.min(1, Math.max(0, crop.x));
    const sy = (bitmap.height - cropHeight) * Math.min(1, Math.max(0, crop.y));
    const scale = Math.min(1, maxSide / Math.max(cropWidth, cropHeight));
    const width = Math.max(1, Math.round(cropWidth * scale));
    const height = Math.max(1, Math.round(cropHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Le navigateur ne peut pas traiter cette image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, sx, sy, cropWidth, cropHeight, 0, 0, width, height);

    let output: Blob | null = null;
    let outputType = "image/webp";
    for (const quality of [0.8, 0.74, 0.68, 0.62, 0.56]) {
      output = await canvasBlob(canvas, outputType, quality);
      if (output?.type !== outputType) output = null;
      if (output && output.size <= targetBytes) break;
    }
    if (!output || output.size > maxBytes) {
      outputType = "image/jpeg";
      for (const quality of [0.8, 0.74, 0.68, 0.62, 0.56, 0.5]) {
        output = await canvasBlob(canvas, outputType, quality);
        if (output?.type !== outputType) output = null;
        if (output && output.size <= targetBytes) break;
      }
    }
    if (!output) throw new Error("La photo n’a pas pu être compressée.");
    if (output.size > maxBytes) throw new Error(`L’image reste supérieure à ${Math.round(maxBytes / 1000)} Ko après compression.`);
    const extension = outputType === "image/webp" ? "webp" : "jpg";
    const filename = `${source.name.replace(/\.[^.]+$/, "") || "image"}.${extension}`;
    return { file: new File([output], filename, { type: outputType, lastModified: Date.now() }), width, height };
  } finally {
    bitmap.close();
  }
}
