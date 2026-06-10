import type { Placement, PosterInput } from "./printLayout";

export type LoadedPosterImage = PosterInput & {
  element: HTMLImageElement;
};

export async function loadPosterImage(poster: PosterInput): Promise<LoadedPosterImage> {
  const element = await loadImage(poster.url);
  return { ...poster, element };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be loaded."));
    image.src = src;
  });
}

export function getRotatedImageCanvas(image: HTMLImageElement, rotation: number): HTMLCanvasElement | HTMLImageElement {
  if (!rotation) return image;
  const canvas = document.createElement("canvas");
  const isSwapped = rotation === 90 || rotation === 270;
  canvas.width = isSwapped ? image.naturalHeight : image.naturalWidth;
  canvas.height = isSwapped ? image.naturalWidth : image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas;
}

export function coverCrop(
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
  anchor = { x: 0.5, y: 0.5 }
) {
  const imageRatio = imageWidth / imageHeight;
  const targetRatio = targetWidth / targetHeight;
  let sx = 0;
  let sy = 0;
  let sw = imageWidth;
  let sh = imageHeight;

  if (imageRatio > targetRatio) {
    sw = imageHeight * targetRatio;
    sx = clamp((imageWidth - sw) * anchor.x, 0, imageWidth - sw);
  } else {
    sh = imageWidth / targetRatio;
    sy = clamp((imageHeight - sh) * anchor.y, 0, imageHeight - sh);
  }

  return { sx, sy, sw, sh };
}

export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  placement: Placement,
  pxPerMm: number,
  bleedMm = 0
) {
  const x = (placement.x - bleedMm) * pxPerMm;
  const y = (placement.y - bleedMm) * pxPerMm;
  const width = (placement.width + bleedMm * 2) * pxPerMm;
  const height = (placement.height + bleedMm * 2) * pxPerMm;

  // 1. Get rotated image source canvas
  const rotation = placement.crop?.rotation || 0;
  const rotatedSrc = getRotatedImageCanvas(image, rotation);

  // 2. Determine source crop coordinates
  let sx = 0;
  let sy = 0;
  let sw = rotatedSrc instanceof HTMLCanvasElement ? rotatedSrc.width : image.naturalWidth;
  let sh = rotatedSrc instanceof HTMLCanvasElement ? rotatedSrc.height : image.naturalHeight;

  if (placement.crop) {
    // Custom user crop
    sx = placement.crop.x;
    sy = placement.crop.y;
    sw = placement.crop.width;
    sh = placement.crop.height;
  } else {
    // Auto crop center-crop
    const crop = coverCrop(sw, sh, placement.width, placement.height);
    sx = crop.sx;
    sy = crop.sy;
    sw = crop.sw;
    sh = crop.sh;
  }

  ctx.save();

  // 3. Translate to center of destination rect to apply flipping
  const cx = x + width / 2;
  const cy = y + height / 2;
  ctx.translate(cx, cy);

  // Apply flip transforms on centered context
  const fX = placement.crop?.flipX ? -1 : 1;
  const fY = placement.crop?.flipY ? -1 : 1;
  if (fX !== 1 || fY !== 1) {
    ctx.scale(fX, fY);
  }

  // 4. Draw relative to center based on resizeMode
  const mode = placement.resizeMode || "fill";

  if (mode === "fit") {
    // Fit image inside target, adding letterbox margins
    const scale = Math.min(width / sw, height / sh);
    const fitW = sw * scale;
    const fitH = sh * scale;
    ctx.drawImage(rotatedSrc, sx, sy, sw, sh, -fitW / 2, -fitH / 2, fitW, fitH);
  } else {
    // Fill/Center crop
    ctx.drawImage(rotatedSrc, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
  }

  ctx.restore();
}

export async function readFileDimensions(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
