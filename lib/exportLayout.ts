import { jsPDF } from "jspdf";
import { drawImageCover, loadPosterImage } from "./imageTools";
import { LayoutResult, LayoutSettings, PosterInput, Placement } from "./printLayout";

const MM_PER_INCH = 25.4;
const EXPORT_DPI = 300;

export async function renderLayoutToCanvas(
  layout: LayoutResult,
  posters: PosterInput[],
  settings: LayoutSettings,
  dpi = EXPORT_DPI
) {
  const pxPerMm = dpi / MM_PER_INCH;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(layout.sheet.width * pxPerMm);
  canvas.height = Math.round(layout.sheet.height * pxPerMm);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const loaded = await Promise.all(posters.map((poster) => loadPosterImage(poster)));
  const bleedMm = settings.bleed ? 3 : 0;

  for (const placement of layout.placements) {
    const poster = loaded[placement.sourceIndex];
    if (!poster) continue;

    ctx.save();

    // Translate to center of placement in pixels
    const cx = (placement.x + placement.width / 2) * pxPerMm;
    const cy = (placement.y + placement.height / 2) * pxPerMm;
    ctx.translate(cx, cy);

    if (placement.rotation) {
      ctx.rotate((placement.rotation * Math.PI) / 180);
    }

    const w = placement.width * pxPerMm;
    const h = placement.height * pxPerMm;

    // Draw image content inside clipping boundary relative to center
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();

    const relativePlacement: Placement = {
      ...placement,
      x: -placement.width / 2,
      y: -placement.height / 2
    };
    drawImageCover(ctx, poster.element, relativePlacement, pxPerMm, bleedMm);
    ctx.restore();

    // Draw borders relative to center
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1, Math.round(0.08 * pxPerMm));
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    // Draw cut marks relative to center
    if (settings.cutMarks) {
      const relPlacement = {
        x: -placement.width / 2,
        y: -placement.height / 2,
        width: placement.width,
        height: placement.height
      };
      drawCutMarks(ctx, relPlacement, pxPerMm);
    }

    ctx.restore();
  }

  return canvas;
}

export async function downloadRaster(
  layout: LayoutResult,
  posters: PosterInput[],
  settings: LayoutSettings,
  format: "png" | "jpeg"
) {
  const canvas = await renderLayoutToCanvas(layout, posters, settings);
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mime, format === "jpeg" ? 0.96 : undefined);
  downloadDataUrl(dataUrl, `poster-kadai-${layout.mode.toLowerCase()}-a3.${format === "jpeg" ? "jpg" : "png"}`);
}

export async function downloadPdf(layout: LayoutResult, posters: PosterInput[], settings: LayoutSettings) {
  const canvas = await renderLayoutToCanvas(layout, posters, settings);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.98);
  const pdf = new jsPDF({
    unit: "mm",
    format: [layout.sheet.width, layout.sheet.height],
    orientation: layout.sheet.orientation,
    compress: true
  });
  pdf.addImage(dataUrl, "JPEG", 0, 0, layout.sheet.width, layout.sheet.height, undefined, "FAST");
  pdf.save(`poster-kadai-${layout.mode.toLowerCase()}-a3.pdf`);
}

function drawCutMarks(ctx: CanvasRenderingContext2D, placement: { x: number; y: number; width: number; height: number }, pxPerMm: number) {
  const mark = 5 * pxPerMm;
  const offset = 1.2 * pxPerMm;
  const x1 = placement.x * pxPerMm;
  const y1 = placement.y * pxPerMm;
  const x2 = (placement.x + placement.width) * pxPerMm;
  const y2 = (placement.y + placement.height) * pxPerMm;
  ctx.save();
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = Math.max(1, Math.round(0.12 * pxPerMm));
  ctx.beginPath();
  corner(ctx, x1, y1, -1, -1, mark, offset);
  corner(ctx, x2, y1, 1, -1, mark, offset);
  corner(ctx, x1, y2, -1, 1, mark, offset);
  corner(ctx, x2, y2, 1, 1, mark, offset);
  ctx.stroke();
  ctx.restore();
}

function corner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirX: -1 | 1,
  dirY: -1 | 1,
  mark: number,
  offset: number
) {
  ctx.moveTo(x + dirX * offset, y);
  ctx.lineTo(x + dirX * (offset + mark), y);
  ctx.moveTo(x, y + dirY * offset);
  ctx.lineTo(x, y + dirY * (offset + mark));
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
