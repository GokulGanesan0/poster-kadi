"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCw, ZoomIn, ZoomOut, Maximize2, RotateCcw, X, Check, FlipHorizontal, FlipVertical } from "lucide-react";
import clsx from "clsx";

type CropSettings = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
};

type CropModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (crop: CropSettings) => void;
  imageUrl: string;
  imageName: string;
  aspectPreset?: "A4" | "A5" | "A6" | "free";
  currentCrop?: CropSettings;
};

export default function CropModal({
  isOpen,
  onClose,
  onSave,
  imageUrl,
  imageName,
  aspectPreset = "free",
  currentCrop
}: CropModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [aspect, setAspect] = useState<"A4" | "A5" | "A6" | "free">(aspectPreset);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lockAspect, setLockAspect] = useState(true);

  // Reset/Initialize state when modal opens
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(currentCrop?.rotation || 0);
      setFlipX(currentCrop?.flipX || false);
      setFlipY(currentCrop?.flipY || false);
      setAspect(aspectPreset);
      setLockAspect(aspectPreset !== "free");
      
      const img = new Image();
      img.onload = () => {
        setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = imageUrl;
    }
  }, [isOpen, imageUrl, aspectPreset, currentCrop]);

  if (!isOpen) return null;

  // Aspect ratio calculations
  const getAspectRatioValue = () => {
    if (!lockAspect || aspect === "free") return null;
    const isLandscape = naturalSize.width > naturalSize.height;
    return isLandscape ? 1.4142 : 0.7071;
  };

  const aspectValue = getAspectRatioValue();

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
  };

  const handleRotateRight = () => {
    setRotation((r) => (r + 90) % 360);
  };

  const handleRotateLeft = () => {
    setRotation((r) => (r - 90 + 360) % 360);
  };

  const handleFlipX = () => {
    setFlipX((f) => !f);
  };

  const handleFlipY = () => {
    setFlipY((f) => !f);
  };

  const handleSave = () => {
    if (!imageRef.current || !containerRef.current) return;

    const img = imageRef.current;
    const container = containerRef.current;

    // Viewport dimensions
    const vW = container.clientWidth;
    const vH = container.clientHeight;

    // Crop box dimensions on screen (centered)
    let cW = vW - 48; // padding margin
    let cH = vH - 48;

    if (aspectValue) {
      if (cW / cH > aspectValue) {
        cW = cH * aspectValue;
      } else {
        cH = cW / aspectValue;
      }
    }

    // Calculate actual rendered dimensions of the image inside the container
    const naturalRatio = naturalSize.width / naturalSize.height;
    const maxImgW = vW * 0.7;
    const maxImgH = vH * 0.7;
    
    let iW = 0;
    let iH = 0;
    
    if (naturalSize.width > 0 && naturalSize.height > 0) {
      if (naturalRatio > maxImgW / maxImgH) {
        iW = maxImgW;
        iH = maxImgW / naturalRatio;
      } else {
        iH = maxImgH;
        iW = maxImgH * naturalRatio;
      }
    } else {
      iW = img.clientWidth || 300;
      iH = img.clientHeight || 300;
    }

    // If rotated 90 or 270, swap display size
    const isSwapped = rotation === 90 || rotation === 270;
    const displayW = isSwapped ? iH : iW;
    const displayH = isSwapped ? iW : iH;

    // Center of container
    const cx = vW / 2;
    const cy = vH / 2;

    // Top-left of crop box on screen
    const cbX = cx - cW / 2;
    const cbY = cy - cH / 2;

    // Center of image on screen
    const imgCx = cx + pan.x;
    const imgCy = cy + pan.y;

    // Top-left of image on screen (rotated)
    const imgX = imgCx - (displayW * zoom) / 2;
    const imgY = imgCy - (displayH * zoom) / 2;

    // Offsets of crop box relative to rotated image top-left (incorporating flips)
    const ox = flipX ? (imgX + displayW * zoom) - (cbX + cW) : cbX - imgX;
    const oy = flipY ? (imgY + displayH * zoom) - (cbY + cH) : cbY - imgY;

    // Normalized coordinates on rotated image (0.0 to 1.0)
    let nx = ox / (displayW * zoom);
    let ny = oy / (displayH * zoom);
    let nw = cW / (displayW * zoom);
    let nh = cH / (displayH * zoom);

    // Clamp normalized values to 0..1
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    nw = Math.max(0, Math.min(1 - nx, nw));
    nh = Math.max(0, Math.min(1 - ny, nh));

    // Convert back to original natural coordinates
    const natW = isSwapped ? naturalSize.height : naturalSize.width;
    const natH = isSwapped ? naturalSize.width : naturalSize.height;

    // Calculate crop rectangle on the rotated image
    const cropX = Math.round(nx * natW);
    const cropY = Math.round(ny * natH);
    const cropWidth = Math.round(nw * natW);
    const cropHeight = Math.round(nh * natH);

    onSave({
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
      rotation: rotation,
      flipX: flipX,
      flipY: flipY
    });
  };

  // Compute crop box style for visual overlay
  const getCropBoxStyle = () => {
    if (!containerRef.current) return {};
    const vW = containerRef.current.clientWidth;
    const vH = containerRef.current.clientHeight;

    let cW = vW - 48;
    let cH = vH - 48;

    if (aspectValue) {
      if (cW / cH > aspectValue) {
        cW = cH * aspectValue;
      } else {
        cH = cW / aspectValue;
      }
    }

    return {
      width: `${cW}px`,
      height: `${cH}px`,
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.65)"
    };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-4 backdrop-blur-sm">
      <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-line bg-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-paper">Crop & Transform Image</h3>
            <p className="text-xs text-paper/50 truncate max-w-md mt-0.5">{imageName}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-paper/60 hover:bg-panelSoft hover:text-paper">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Viewport Area */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden bg-black/60 cursor-grab active:cursor-grabbing flex items-center justify-center select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {imageUrl && (
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Crop target"
              className="max-h-[70%] max-w-[70%] object-contain pointer-events-none transition-transform duration-75"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scaleX(${flipX ? -zoom : zoom}) scaleY(${flipY ? -zoom : zoom}) rotate(${rotation}deg)`
              }}
            />
          )}

          {/* Semi-transparent mask with center crop box */}
          <div
            style={getCropBoxStyle()}
            className="absolute pointer-events-none border-2 border-dashed border-ember/90 rounded-sm"
          >
            {/* Grid overlay lines inside crop frame */}
            <div className="grid grid-cols-3 grid-rows-3 w-full h-full opacity-35">
              <div className="border-r border-b border-paper border-dashed"></div>
              <div className="border-r border-b border-paper border-dashed"></div>
              <div className="border-b border-paper border-dashed"></div>
              <div className="border-r border-b border-paper border-dashed"></div>
              <div className="border-r border-b border-paper border-dashed"></div>
              <div className="border-b border-paper border-dashed"></div>
              <div className="border-r border-paper border-dashed"></div>
              <div className="border-r border-paper border-dashed"></div>
              <div></div>
            </div>
            {/* Dimensions Indicator */}
            {naturalSize.width > 0 && (
              <div className="absolute -bottom-7 left-0 right-0 text-center text-xs font-mono text-ember drop-shadow-md">
                Original Size: {naturalSize.width} × {naturalSize.height} px
              </div>
            )}
          </div>
        </div>

        {/* Controls Panel */}
        <div className="border-t border-line bg-panelSoft p-5 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Aspect Ratios */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-paper/40 mr-1">Aspect Ratio</span>
              {(["free", "A4", "A5", "A6"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setAspect(mode);
                    setLockAspect(mode !== "free");
                  }}
                  className={clsx(
                    "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium border transition",
                    aspect === mode
                      ? "border-ember bg-ember/15 text-paper"
                      : "border-line bg-ink/35 text-paper/70 hover:bg-ink"
                  )}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Transformations: Flips & Rotations & Reset */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Rotate Buttons */}
              <button
                onClick={handleRotateLeft}
                className="flex items-center gap-1.5 rounded border border-line bg-ink/35 px-3 py-1.5 text-xs font-medium text-paper/80 hover:bg-ink transition"
                title="Rotate 90° Counter-Clockwise"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Rotate L</span>
              </button>
              <button
                onClick={handleRotateRight}
                className="flex items-center gap-1.5 rounded border border-line bg-ink/35 px-3 py-1.5 text-xs font-medium text-paper/80 hover:bg-ink transition"
                title="Rotate 90° Clockwise"
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span>Rotate R</span>
              </button>

              {/* Flip Buttons */}
              <button
                onClick={handleFlipX}
                className={clsx(
                  "flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition",
                  flipX
                    ? "border-ember bg-ember/15 text-paper"
                    : "border-line bg-ink/35 text-paper/80 hover:bg-ink"
                )}
                title="Flip Horizontally"
              >
                <FlipHorizontal className="h-3.5 w-3.5" />
                <span>Flip H</span>
              </button>
              <button
                onClick={handleFlipY}
                className={clsx(
                  "flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition",
                  flipY
                    ? "border-ember bg-ember/15 text-paper"
                    : "border-line bg-ink/35 text-paper/80 hover:bg-ink"
                )}
                title="Flip Vertically"
              >
                <FlipVertical className="h-3.5 w-3.5" />
                <span>Flip V</span>
              </button>

              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 rounded border border-line bg-ink/35 px-3 py-1.5 text-xs font-medium text-paper/80 hover:bg-ink transition"
                title="Reset all transformations"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Zoom Slider */}
            <div className="flex flex-1 items-center gap-3 max-w-md">
              <ZoomOut className="h-4 w-4 text-paper/40" />
              <input
                type="range"
                min="1"
                max="5"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="range-control flex-1 h-1.5 bg-ink rounded-lg appearance-none cursor-pointer accent-ember"
              />
              <ZoomIn className="h-4 w-4 text-paper/40" />
              <span className="text-xs font-mono text-paper/60 w-10 text-right">{Math.round(zoom * 100)}%</span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="rounded-md border border-line bg-ink/20 px-4 py-2 text-sm font-medium text-paper/70 hover:bg-ink hover:text-paper transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-2 rounded-md bg-paper px-5 py-2 text-sm font-medium text-ink hover:bg-white transition"
              >
                <Check className="h-4 w-4" />
                <span>Apply Changes</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
