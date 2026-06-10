"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import { coverCrop, getRotatedImageCanvas, loadImage } from "@/lib/imageTools";
import type { LayoutResult, LayoutSettings, Placement, PosterInput } from "@/lib/printLayout";

type SheetPreviewProps = {
  layout: LayoutResult;
  posters: PosterInput[];
  settings: LayoutSettings;
  manualMode?: boolean;
  onUpdatePlacements?: (placements: Placement[]) => void;
  selectedPlacementId?: string | null;
  onSelectPlacement?: (id: string | null) => void;
};

export default function SheetPreview({
  layout,
  posters,
  settings,
  manualMode = false,
  onUpdatePlacements,
  selectedPlacementId = null,
  onSelectPlacement
}: SheetPreviewProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);

  const [width, setWidth] = useState(640);
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const [transformingItem, setTransformingItem] = useState<{
    id: string;
    width: number;
    height: number;
    x: number;
    y: number;
  } | null>(null);

  // Resize observer to handle responsive canvas width
  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(260, Math.floor(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Pre-load images
  useEffect(() => {
    let active = true;
    Promise.all(
      posters.map(async (poster) => {
        const image = await loadImage(poster.url);
        return [poster.id, image] as const;
      })
    )
      .then((entries) => {
        if (active) setImages(Object.fromEntries(entries));
      })
      .catch(() => {
        if (active) setImages({});
      });
    return () => {
      active = false;
    };
  }, [posters]);

  // Compute screen scale (px/mm) based on layout size and container width
  const stage = useMemo(() => {
    const ratio = layout.sheet.height / layout.sheet.width;
    const stageWidth = width;
    const stageHeight = Math.round(stageWidth * ratio);
    return { width: stageWidth, height: stageHeight, scale: stageWidth / layout.sheet.width };
  }, [layout.sheet.height, layout.sheet.width, width]);

  // Attach transformer to selected node
  useEffect(() => {
    if (!manualMode || !transformerRef.current || !stageRef.current) return;

    if (selectedPlacementId) {
      const selectedNode = stageRef.current.findOne(`#node-${selectedPlacementId}`);
      if (selectedNode) {
        transformerRef.current.nodes([selectedNode]);
        transformerRef.current.getLayer().batchDraw();
      } else {
        transformerRef.current.nodes([]);
      }
    } else {
      transformerRef.current.nodes([]);
    }
  }, [selectedPlacementId, manualMode, layout.placements]);

  // Deselect on clicking empty background
  const handleStageClick = (e: any) => {
    if (!manualMode) return;
    if (e.target === e.target.getStage() || e.target.id() === "sheet-bg" || e.target.id() === "margin-border") {
      if (onSelectPlacement) onSelectPlacement(null);
    }
  };

  // Grid background renderer
  const renderGridLines = () => {
    if (!manualMode) return null;

    const lines = [];
    const gridSpacingMm = 10; // 10mm major grid
    const minorSpacingMm = 5; // 5mm minor grid
    const maxW = layout.sheet.width;
    const maxH = layout.sheet.height;
    const scale = stage.scale;

    // Draw minor grid lines
    for (let x = minorSpacingMm; x < maxW; x += minorSpacingMm) {
      const isMajor = x % gridSpacingMm === 0;
      lines.push(
        <Line
          key={`minor-v-${x}`}
          points={[x * scale, 0, x * scale, maxH * scale]}
          stroke={isMajor ? "#e3dec9" : "#f2eedf"}
          strokeWidth={isMajor ? 1 : 0.5}
        />
      );
    }

    for (let y = minorSpacingMm; y < maxH; y += minorSpacingMm) {
      const isMajor = y % gridSpacingMm === 0;
      lines.push(
        <Line
          key={`minor-h-${y}`}
          points={[0, y * scale, maxW * scale, y * scale]}
          stroke={isMajor ? "#e3dec9" : "#f2eedf"}
          strokeWidth={isMajor ? 1 : 0.5}
        />
      );
    }

    return lines;
  };

  const handleDragMove = (placementId: string, e: any) => {
    if (!onUpdatePlacements) return;

    const node = e.target;
    // Get raw coords in pixels
    const rawX = node.x();
    const rawY = node.y();

    // Convert to mm
    const rawXmm = rawX / stage.scale;
    const rawYmm = rawY / stage.scale;

    // Snap to 5mm grid
    const gridStep = 5;
    const snappedXmm = Math.round(rawXmm / gridStep) * gridStep;
    const snappedYmm = Math.round(rawYmm / gridStep) * gridStep;

    // Snap node position on screen
    node.x(snappedXmm * stage.scale);
    node.y(snappedYmm * stage.scale);

    const targetPl = layout.placements.find((p) => p.id === placementId);
    if (targetPl) {
      setTransformingItem({
        id: placementId,
        x: snappedXmm,
        y: snappedYmm,
        width: targetPl.width,
        height: targetPl.height
      });
    }
  };

  const handleDragEnd = (placementId: string, e: any) => {
    setTransformingItem(null);
    if (!onUpdatePlacements) return;

    const node = e.target;
    const finalXmm = Math.round((node.x() / stage.scale) / 1) * 1;
    const finalYmm = Math.round((node.y() / stage.scale) / 1) * 1;

    const updatedPlacements = layout.placements.map((p) => {
      if (p.id === placementId) {
        return {
          ...p,
          x: finalXmm,
          y: finalYmm
        };
      }
      return p;
    });

    onUpdatePlacements(updatedPlacements);
  };

  const handleTransform = (placementId: string, e: any) => {
    const node = e.target;
    
    // Scale node and resize
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    
    const newWpx = node.width() * scaleX;
    const newHpx = node.height() * scaleY;
    const newXpx = node.x();
    const newYpx = node.y();

    // Convert to mm
    const newWmm = newWpx / stage.scale;
    const newHmm = newHpx / stage.scale;
    const newXmm = newXpx / stage.scale;
    const newYmm = newYpx / stage.scale;

    // Snap to 5mm grid for display tooltip
    const gridStep = 5;
    const snappedWmm = Math.round(newWmm / gridStep) * gridStep;
    const snappedHmm = Math.round(newHmm / gridStep) * gridStep;
    const snappedXmm = Math.round(newXmm / gridStep) * gridStep;
    const snappedYmm = Math.round(newYmm / gridStep) * gridStep;

    setTransformingItem({
      id: placementId,
      x: snappedXmm,
      y: snappedYmm,
      width: snappedWmm,
      height: snappedHmm
    });
  };

  const handleTransformEnd = (placementId: string, e: any) => {
    setTransformingItem(null);
    if (!onUpdatePlacements) return;

    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Calculate final size snapped to 5mm grid
    const gridStep = 5;
    const finalWmm = Math.round(((node.width() * scaleX) / stage.scale) / gridStep) * gridStep;
    const finalHmm = Math.round(((node.height() * scaleY) / stage.scale) / gridStep) * gridStep;
    const finalXmm = Math.round((node.x() / stage.scale) / gridStep) * gridStep;
    const finalYmm = Math.round((node.y() / stage.scale) / gridStep) * gridStep;
    const finalRotation = Math.round(node.rotation());

    // Reset scales so the new width and height render at scale 1 without double scaling
    node.scaleX(1);
    node.scaleY(1);

    const updatedPlacements = layout.placements.map((p) => {
      if (p.id === placementId) {
        return {
          ...p,
          x: finalXmm,
          y: finalYmm,
          width: finalWmm,
          height: finalHmm,
          rotated: finalRotation !== 0,
          rotation: finalRotation,
          scale: 1 // Manual adjustments have custom size
        };
      }
      return p;
    });

    onUpdatePlacements(updatedPlacements);
  };

  return (
    <div ref={shellRef} className="w-full overflow-hidden rounded-md border border-line bg-ink p-3 print-grid">
      <Stage
        ref={stageRef}
        width={stage.width}
        height={stage.height}
        onClick={handleStageClick}
        onTap={handleStageClick}
      >
        <Layer>
          {/* Base A3 Page Sheet */}
          <Rect
            id="sheet-bg"
            x={0}
            y={0}
            width={stage.width}
            height={stage.height}
            fill="#f7f3ea"
            shadowBlur={12}
            shadowOpacity={0.18}
          />

          {/* Grid lines */}
          {renderGridLines()}

          {/* Margins Border */}
          {settings.marginMm > 0 ? (
            <Rect
              id="margin-border"
              x={settings.marginMm * stage.scale}
              y={settings.marginMm * stage.scale}
              width={(layout.sheet.width - settings.marginMm * 2) * stage.scale}
              height={(layout.sheet.height - settings.marginMm * 2) * stage.scale}
              stroke="#d7b86d"
              dash={[8, 6]}
              strokeWidth={1}
            />
          ) : null}

          {/* Placed Poster Frames */}
          {layout.placements.map((placement) => {
            const poster = posters[placement.sourceIndex];
            const image = poster ? images[poster.id] : undefined;
            const isSelected = selectedPlacementId === placement.id;

            return (
              <Group
                key={placement.id}
                id={`node-${placement.id}`}
                x={placement.x * stage.scale}
                y={placement.y * stage.scale}
                width={placement.width * stage.scale}
                height={placement.height * stage.scale}
                rotation={placement.rotation || 0}
                draggable={manualMode}
                onDragMove={(e) => handleDragMove(placement.id, e)}
                onDragEnd={(e) => handleDragEnd(placement.id, e)}
                onTransform={(e) => handleTransform(placement.id, e)}
                onTransformEnd={(e) => handleTransformEnd(placement.id, e)}
                onClick={() => manualMode && onSelectPlacement && onSelectPlacement(placement.id)}
                onTap={() => manualMode && onSelectPlacement && onSelectPlacement(placement.id)}
              >
                <PosterFrame
                  image={image}
                  placement={placement}
                  scale={stage.scale}
                  cutMarks={settings.cutMarks && !manualMode} // disable cut marks during manual design mode
                  bleed={settings.bleed}
                  isSelected={isSelected}
                  manualMode={manualMode}
                />
              </Group>
            );
          })}

          {/* Konva Transformer Handle */}
          {manualMode && (
            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                // Minimum size 15mm
                const minSize = 15 * stage.scale;
                if (newBox.width < minSize || newBox.height < minSize) {
                  return oldBox;
                }
                return newBox;
              }}
              rotateAnchor={true}
              keepRatio={false}
              anchorStroke="#e35d32"
              anchorFill="#e35d32"
              borderStroke="#e35d32"
              anchorSize={8}
            />
          )}

          {/* Dimension tooltips during drag or resize */}
          {manualMode && transformingItem && (
            <Group
              x={transformingItem.x * stage.scale}
              y={(transformingItem.y - 12) * stage.scale}
            >
              <Rect
                x={0}
                y={0}
                width={130}
                height={38}
                fill="rgba(20,20,20,0.85)"
                cornerRadius={4}
                stroke="#e35d32"
                strokeWidth={1}
              />
              <Text
                x={8}
                y={6}
                text={`Size: ${Math.round(transformingItem.width)}×${Math.round(transformingItem.height)} mm`}
                fontSize={9}
                fontFamily="monospace"
                fill="#ffffff"
              />
              <Text
                x={8}
                y={20}
                text={`Pos: X:${Math.round(transformingItem.x)} Y:${Math.round(transformingItem.y)} mm`}
                fontSize={9}
                fontFamily="monospace"
                fill="#ffffff"
              />
            </Group>
          )}
        </Layer>
      </Stage>
    </div>
  );
}

function PosterFrame({
  image,
  placement,
  scale,
  cutMarks,
  bleed,
  isSelected,
  manualMode
}: {
  image?: HTMLImageElement;
  placement: Placement;
  scale: number;
  cutMarks: boolean;
  bleed: boolean;
  isSelected?: boolean;
  manualMode?: boolean;
}) {
  const width = placement.width * scale;
  const height = placement.height * scale;

  // 1. Get rotated image source (pre-rotated helper canvas)
  const rotation = placement.crop?.rotation || 0;
  const rotatedSrc = useMemo(() => {
    if (!image) return undefined;
    return getRotatedImageCanvas(image, rotation);
  }, [image, rotation]);

  // 2. Determine crop coordinates
  const crop = useMemo(() => {
    if (!image) return undefined;
    const sw = rotatedSrc instanceof HTMLCanvasElement ? rotatedSrc.width : image.naturalWidth;
    const sh = rotatedSrc instanceof HTMLCanvasElement ? rotatedSrc.height : image.naturalHeight;

    if (placement.crop) {
      return {
        sx: placement.crop.x,
        sy: placement.crop.y,
        sw: placement.crop.width,
        sh: placement.crop.height
      };
    }
    // cover crop fallback
    const cover = coverCrop(sw, sh, placement.width, placement.height);
    return { sx: cover.sx, sy: cover.sy, sw: cover.sw, sh: cover.sh };
  }, [image, rotatedSrc, placement.crop, placement.width, placement.height]);

  // 3. Compute fitting / resize dimensions
  const fitCoords = useMemo(() => {
    if (!crop) return { x: 0, y: 0, w: width, h: height };
    if (placement.resizeMode === "fit") {
      const scaleFactor = Math.min(width / crop.sw, height / crop.sh);
      const w = crop.sw * scaleFactor;
      const h = crop.sh * scaleFactor;
      return {
        x: (width - w) / 2,
        y: (height - h) / 2,
        w,
        h
      };
    }
    return { x: 0, y: 0, w: width, h: height };
  }, [crop, placement.resizeMode, width, height]);

  const label = `${placement.size} ${Math.round(placement.width)} x ${Math.round(placement.height)} mm`;
  const labelWidth = Math.min(Math.max(label.length * 5.5, 72), Math.max(72, width - 8));
  const showLabel = width > 70 && height > 42;

  return (
    <Group>
      {/* Bleed outline */}
      {bleed ? (
        <Rect
          x={-3 * scale}
          y={-3 * scale}
          width={width + 6 * scale}
          height={height + 6 * scale}
          stroke="#e35d32"
          dash={[5, 5]}
          strokeWidth={1}
        />
      ) : null}

      {/* Main Image Layer */}
      {rotatedSrc && crop ? (
        <KonvaImage
          image={rotatedSrc}
          x={fitCoords.x + fitCoords.w / 2}
          y={fitCoords.y + fitCoords.h / 2}
          width={fitCoords.w}
          height={fitCoords.h}
          offsetX={fitCoords.w / 2}
          offsetY={fitCoords.h / 2}
          scaleX={placement.crop?.flipX ? -1 : 1}
          scaleY={placement.crop?.flipY ? -1 : 1}
          crop={{ x: crop.sx, y: crop.sy, width: crop.sw, height: crop.sh }}
        />
      ) : (
        <Rect x={0} y={0} width={width} height={height} fill="#d8d0c2" />
      )}

      {/* Frame Border Outline */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        stroke={isSelected ? "#e35d32" : "#111111"}
        strokeWidth={isSelected ? 2 : 1}
      />

      {/* Selected Indicator background overlay */}
      {isSelected && (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="rgba(227, 93, 50, 0.08)"
          listening={false}
        />
      )}

      {/* Dimension Label overlay */}
      {showLabel ? (
        <Group>
          <Rect x={4} y={4} width={labelWidth} height={18} fill="rgba(18,18,18,0.78)" cornerRadius={3} />
          <Text x={8} y={8} text={label} fontSize={10} fill="#f8f4eb" width={labelWidth - 8} />
        </Group>
      ) : null}

      {/* Cut Marks */}
      {cutMarks ? <CutMarks x={0} y={0} width={width} height={height} scale={scale} /> : null}
    </Group>
  );
}

function CutMarks({ x, y, width, height, scale }: { x: number; y: number; width: number; height: number; scale: number }) {
  const mark = 5 * scale;
  const offset = 1.2 * scale;
  const stroke = "#101010";
  const points = [
    [x - offset, y, x - offset - mark, y],
    [x, y - offset, x, y - offset - mark],
    [x + width + offset, y, x + width + offset + mark, y],
    [x + width, y - offset, x + width, y - offset - mark],
    [x - offset, y + height, x - offset - mark, y + height],
    [x, y + height + offset, x, y + height + offset + mark],
    [x + width + offset, y + height, x + width + offset + mark, y + height],
    [x + width, y + height + offset, x + width, y + height + offset + mark]
  ];
  return (
    <>
      {points.map((point, index) => (
        <Line key={index} points={point} stroke={stroke} strokeWidth={1} />
      ))}
    </>
  );
}
