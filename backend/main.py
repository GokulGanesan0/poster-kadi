from __future__ import annotations

import io
import json
import math
from dataclasses import dataclass
from typing import Any, Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageOps
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as reportlab_canvas

try:
    import cv2
    import numpy as np
except Exception:  # pragma: no cover - OpenCV is optional at import time.
    cv2 = None
    np = None

MM_PER_INCH = 25.4
DPI = 300
PT_PER_MM = 72 / MM_PER_INCH

app = FastAPI(title="Poster Kadai Print Layout Generator API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local desktop app communication
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@dataclass
class Placement:
    source_index: int
    x: float
    y: float
    width: float
    height: float
    size: str
    rotation: float = 0.0
    crop: Optional[dict[str, Any]] = None
    resize_mode: str = "fill"


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/render")
async def render_print_layout(
    layout_json: str = Form(...),
    settings_json: str = Form(...),
    output_format: Literal["pdf", "jpg", "png"] = Form("pdf"),
    files: list[UploadFile] = File(...),
) -> Response:
    try:
        layout = json.loads(layout_json)
        settings = json.loads(settings_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid layout or settings JSON.") from exc

    placements = [
        Placement(
            source_index=int(item["sourceIndex"]),
            x=float(item["x"]),
            y=float(item["y"]),
            width=float(item["width"]),
            height=float(item["height"]),
            size=str(item["size"]),
            rotation=float(item.get("rotation", 0)),
            crop=item.get("crop"),
            resize_mode=str(item.get("resizeMode", "fill")),
        )
        for item in layout.get("placements", [])
    ]
    if not placements:
        raise HTTPException(status_code=400, detail="Layout has no placements.")

    sheet = layout.get("sheet", {})
    sheet_width_mm = float(sheet.get("width", 297))
    sheet_height_mm = float(sheet.get("height", 420))
    cmyk = bool(settings.get("cmyk", False))
    bleed = bool(settings.get("bleed", False))
    cut_marks = bool(settings.get("cutMarks", True))

    images = [await read_upload_image(file) for file in files]
    if output_format == "pdf":
        body = render_pdf(images, placements, sheet_width_mm, sheet_height_mm, cmyk, bleed, cut_marks)
        return Response(content=body, media_type="application/pdf")

    image = render_raster(images, placements, sheet_width_mm, sheet_height_mm, cmyk, bleed, cut_marks)
    buffer = io.BytesIO()
    if output_format == "png":
        image.save(buffer, format="PNG", dpi=(DPI, DPI))
        return Response(content=buffer.getvalue(), media_type="image/png")
    image.convert("RGB").save(buffer, format="JPEG", quality=96, subsampling=0, dpi=(DPI, DPI))
    return Response(content=buffer.getvalue(), media_type="image/jpeg")


async def read_upload_image(file: UploadFile) -> Image.Image:
    content = await file.read()
    try:
        image = Image.open(io.BytesIO(content))
        return ImageOps.exif_transpose(image).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{file.filename} is not a readable image.") from exc


def process_image(
    image: Image.Image,
    placement: Placement,
    cmyk: bool,
    px_per_mm: float,
    bleed_mm: float
) -> Image.Image:
    """
    Process image (apply crop boundaries, rotate, and scale/fit) for a placement.
    """
    # 1. Apply custom crop & rotate first
    if placement.crop:
        crop_rot = placement.crop.get("rotation", 0)
        if crop_rot:
            # PIL rotate is counter-clockwise, so negative for clockwise
            image = image.rotate(-crop_rot, expand=True, resample=Image.Resampling.BICUBIC)
        
        cx = placement.crop["x"]
        cy = placement.crop["y"]
        cw = placement.crop["width"]
        ch = placement.crop["height"]
        # Clamp crop box bounds
        cw = min(cw, image.width - cx)
        ch = min(ch, image.height - cy)
        if cw > 0 and ch > 0:
            image = image.crop((cx, cy, cx + cw, cy + ch))

        # Apply flips to the cropped region
        if placement.crop.get("flipX"):
            flip_lr = getattr(Image, "Transpose", Image).FLIP_LEFT_RIGHT
            image = image.transpose(flip_lr)
        if placement.crop.get("flipY"):
            flip_tb = getattr(Image, "Transpose", Image).FLIP_TOP_BOTTOM
            image = image.transpose(flip_tb)

    if cmyk:
        image = image.convert("CMYK")

    # Target frame size in pixels
    w_px = round((placement.width + bleed_mm * 2) * px_per_mm)
    h_px = round((placement.height + bleed_mm * 2) * px_per_mm)

    mode = placement.resize_mode

    if mode == "fit":
        # Fit inside, add letterbox margins
        scale = min(w_px / image.width, h_px / image.height)
        fit_w = max(1, round(image.width * scale))
        fit_h = max(1, round(image.height * scale))
        resized = image.resize((fit_w, fit_h), Image.Resampling.LANCZOS)
        
        bg_mode = "CMYK" if cmyk else "RGB"
        bg_color = (0, 0, 0, 0) if bg_mode == "CMYK" else (255, 255, 255)
        
        frame_img = Image.new(bg_mode, (w_px, h_px), bg_color)
        frame_img.paste(resized, ((w_px - fit_w) // 2, (h_px - fit_h) // 2))
        return frame_img
    else:
        # Fill / Center / Smart
        if not placement.crop:
            force_center = (mode == "fill" or mode == "center")
            image = crop_cover_subject(image, placement.width, placement.height, force_center=force_center)
            
        return image.resize((w_px, h_px), Image.Resampling.LANCZOS)


def rotate_point(x: float, y: float, angle_deg: float) -> tuple[float, float]:
    angle_rad = math.radians(angle_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)
    rx = x * cos_a - y * sin_a
    ry = x * sin_a + y * cos_a
    return rx, ry


def render_raster(
    images: list[Image.Image],
    placements: list[Placement],
    sheet_width_mm: float,
    sheet_height_mm: float,
    cmyk: bool,
    bleed: bool,
    cut_marks: bool,
) -> Image.Image:
    px_per_mm = DPI / MM_PER_INCH
    sheet_width_px = round(sheet_width_mm * px_per_mm)
    sheet_height_px = round(sheet_height_mm * px_per_mm)
    mode = "CMYK" if cmyk else "RGB"
    background = "white" if mode == "RGB" else (0, 0, 0, 0)
    sheet = Image.new(mode, (sheet_width_px, sheet_height_px), background)
    draw = ImageDraw.Draw(sheet)

    for placement in placements:
        if placement.source_index >= len(images):
            continue

        bleed_mm = 3 if bleed else 0
        
        # Process image content
        target = process_image(images[placement.source_index], placement, cmyk, px_per_mm, bleed_mm)
        
        # Center of placement on sheet
        cx = (placement.x + placement.width / 2) * px_per_mm
        cy = (placement.y + placement.height / 2) * px_per_mm

        # Apply rotation if active
        if placement.rotation:
            target = target.rotate(-placement.rotation, expand=True, resample=Image.Resampling.BICUBIC)

        w_px, h_px = target.size
        paste_x = round(cx - w_px / 2)
        paste_y = round(cy - h_px / 2)

        # Composite image
        sheet.paste(target, (paste_x, paste_y))
        
        # Draw border
        draw_rotated_border(draw, placement, px_per_mm, cmyk)

        # Draw cut marks
        if cut_marks:
            draw_rotated_cut_marks(draw, placement, px_per_mm, cmyk)

    return sheet


def draw_rotated_border(draw: ImageDraw.ImageDraw, placement: Placement, px_per_mm: float, cmyk: bool) -> None:
    color = (30, 30, 30) if not cmyk else (0, 0, 0, 180)
    width = max(1, round(0.12 * px_per_mm))
    
    cx = (placement.x + placement.width / 2) * px_per_mm
    cy = (placement.y + placement.height / 2) * px_per_mm
    w_half = (placement.width * px_per_mm) / 2
    h_half = (placement.height * px_per_mm) / 2
    
    corners = [
        (-w_half, -h_half),
        (w_half, -h_half),
        (w_half, h_half),
        (-w_half, h_half)
    ]
    
    rotated = []
    for x, y in corners:
        rx, ry = rotate_point(x, y, placement.rotation)
        rotated.append((rx + cx, ry + cy))
        
    for i in range(4):
        draw.line([rotated[i], rotated[(i + 1) % 4]], fill=color, width=width)


def draw_rotated_cut_marks(draw: ImageDraw.ImageDraw, placement: Placement, px_per_mm: float, cmyk: bool) -> None:
    color = (0, 0, 0) if not cmyk else (0, 0, 0, 255)
    mark = 5 * px_per_mm
    offset = 1.2 * px_per_mm
    width = max(1, round(0.12 * px_per_mm))

    cx = (placement.x + placement.width / 2) * px_per_mm
    cy = (placement.y + placement.height / 2) * px_per_mm
    w_half = (placement.width * px_per_mm) / 2
    h_half = (placement.height * px_per_mm) / 2

    # Define segments relative to center
    x1, y1 = -w_half, -h_half
    x2, y2 = w_half, h_half

    segments = [
        ((x1 - offset, y1), (x1 - offset - mark, y1)),
        ((x1, y1 - offset), (x1, y1 - offset - mark)),
        ((x2 + offset, y1), (x2 + offset + mark, y1)),
        ((x2, y1 - offset), (x2, y1 - offset - mark)),
        ((x1 - offset, y2), (x1 - offset - mark, y2)),
        ((x1, y2 + offset), (x1, y2 + offset + mark)),
        ((x2 + offset, y2), (x2 + offset + mark, y2)),
        ((x2, y2 + offset), (x2, y2 + offset + mark)),
    ]

    for start, end in segments:
        rx1, ry1 = rotate_point(start[0], start[1], placement.rotation)
        rx2, ry2 = rotate_point(end[0], end[1], placement.rotation)
        draw.line([(rx1 + cx, ry1 + cy), (rx2 + cx, ry2 + cy)], fill=color, width=width)


def render_pdf(
    images: list[Image.Image],
    placements: list[Placement],
    sheet_width_mm: float,
    sheet_height_mm: float,
    cmyk: bool,
    bleed: bool,
    cut_marks: bool,
) -> bytes:
    buffer = io.BytesIO()
    pdf = reportlab_canvas.Canvas(buffer, pagesize=(sheet_width_mm * PT_PER_MM, sheet_height_mm * PT_PER_MM))
    pdf.setFillColorRGB(1, 1, 1)
    pdf.rect(0, 0, sheet_width_mm * PT_PER_MM, sheet_height_mm * PT_PER_MM, stroke=0, fill=1)

    for placement in placements:
        if placement.source_index >= len(images):
            continue

        bleed_mm = 3 if bleed else 0
        px_per_mm = DPI / MM_PER_INCH
        
        # Process image content in Python
        processed_img = process_image(images[placement.source_index], placement, cmyk, px_per_mm, bleed_mm)
        image_reader = ImageReader(processed_img)

        # Center of placement in PDF coordinate spaces (Y starts from bottom)
        cx = (placement.x + placement.width / 2) * PT_PER_MM
        cy = (sheet_height_mm - placement.y - placement.height / 2) * PT_PER_MM

        w_pt = (placement.width + bleed_mm * 2) * PT_PER_MM
        h_pt = (placement.height + bleed_mm * 2) * PT_PER_MM

        pdf.saveState()

        # Translate and rotate coordinates
        pdf.translate(cx, cy)
        if placement.rotation:
            pdf.rotate(-placement.rotation)

        # Apply clipping mask
        clip_w = placement.width * PT_PER_MM
        clip_h = placement.height * PT_PER_MM
        clip = pdf.beginPath()
        clip.rect(-clip_w / 2, -clip_h / 2, clip_w, clip_h)
        pdf.clipPath(clip, stroke=0, fill=0)

        # Draw content
        pdf.drawImage(image_reader, -w_pt / 2, -h_pt / 2, width=w_pt, height=h_pt, preserveAspectRatio=False, mask=None)
        pdf.restoreState()

        if cut_marks:
            draw_pdf_cut_marks(pdf, placement, sheet_height_mm)

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def draw_pdf_cut_marks(pdf: reportlab_canvas.Canvas, placement: Placement, sheet_height_mm: float) -> None:
    mark = 5
    offset = 1.2
    
    cx = (placement.x + placement.width / 2) * PT_PER_MM
    cy = (sheet_height_mm - placement.y - placement.height / 2) * PT_PER_MM
    
    pdf.saveState()
    pdf.translate(cx, cy)
    if placement.rotation:
        pdf.rotate(-placement.rotation)
        
    pdf.setStrokeColorCMYK(0, 0, 0, 1)
    pdf.setLineWidth(0.12 * PT_PER_MM)
    
    x1 = -placement.width / 2
    y1 = placement.height / 2
    x2 = placement.width / 2
    y2 = -placement.height / 2
    
    segments = [
        ((x1 - offset, y1), (x1 - offset - mark, y1)),
        ((x1, y1 + offset), (x1, y1 + offset + mark)),
        ((x2 + offset, y1), (x2 + offset + mark, y1)),
        ((x2, y1 + offset), (x2, y1 + offset + mark)),
        ((x1 - offset, y2), (x1 - offset - mark, y2)),
        ((x1, y2 - offset), (x1, y2 - offset - mark)),
        ((x2 + offset, y2), (x2 + offset + mark, y2)),
        ((x2, y2 - offset), (x2, y2 - offset - mark)),
    ]
    
    for start, end in segments:
        pdf.line(start[0] * PT_PER_MM, start[1] * PT_PER_MM, end[0] * PT_PER_MM, end[1] * PT_PER_MM)
        
    pdf.restoreState()


def crop_cover_subject(
    image: Image.Image,
    target_width_mm: float,
    target_height_mm: float,
    force_center: bool = False
) -> Image.Image:
    target_ratio = target_width_mm / target_height_mm
    width, height = image.size
    image_ratio = width / height
    anchor_x, anchor_y = (0.5, 0.5) if force_center else subject_anchor(image)

    if image_ratio > target_ratio:
        crop_width = int(height * target_ratio)
        left = int(max(0, min(width - crop_width, (width - crop_width) * anchor_x)))
        box = (left, 0, left + crop_width, height)
    else:
        crop_height = int(width / target_ratio)
        top = int(max(0, min(height - crop_height, (height - crop_height) * anchor_y)))
        box = (0, top, width, top + crop_height)
    return image.crop(box)


def subject_anchor(image: Image.Image) -> tuple[float, float]:
    if cv2 is None or np is None:
        return 0.5, 0.5

    # Downscale for performance
    target_w = min(900, image.width)
    target_h = int(image.height * target_w / image.width)
    rgb = np.array(image.resize((target_w, target_h)))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        faces = cv2.CascadeClassifier(cascade_path).detectMultiScale(gray, 1.1, 4)
        if len(faces):
            x, y, w, h = max(faces, key=lambda rect: rect[2] * rect[3])
            return (x + w / 2) / gray.shape[1], (y + h / 2) / gray.shape[0]
    except Exception:
        pass

    edges = cv2.Canny(gray, 80, 160)
    moments = cv2.moments(edges)
    if moments["m00"] > 0:
        return moments["m10"] / moments["m00"] / gray.shape[1], moments["m01"] / moments["m00"] / gray.shape[0]
    return 0.5, 0.5
