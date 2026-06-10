export type PosterSize = "A4" | "A5" | "A6";
export type LayoutMode = "A4" | "A5" | "A6" | "MIXED";
export type SheetOrientation = "portrait" | "landscape";

export type PosterInput = {
  id: string;
  name: string;
  width: number;
  height: number;
  size: PosterSize;
  url: string;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    flipX?: boolean;
    flipY?: boolean;
  };
  resizeMode?: "fit" | "fill" | "smart" | "center";
};

export type LayoutSettings = {
  gapMm: number;
  marginMm: number;
  cutMarks: boolean;
  bleed: boolean;
  cmyk: boolean;
};

export type Placement = {
  id: string;
  name: string;
  size: PosterSize;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceIndex: number;
  rotated: boolean;
  scale: number;
  rotation?: number;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    flipX?: boolean;
    flipY?: boolean;
  };
  resizeMode?: "fit" | "fill" | "smart" | "center";
};

export type LayoutResult = {
  mode: LayoutMode;
  sheet: {
    width: number;
    height: number;
    orientation: SheetOrientation;
  };
  placements: Placement[];
  utilization: number;
  posterArea: number;
  sheetArea: number;
  scale: number;
  requiredCount?: number;
  isValid: boolean;
  warnings: string[];
};

export const PAPER_MM = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  A6: { width: 105, height: 148 }
} as const;

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PackItem = {
  id: string;
  name: string;
  sourceIndex: number;
  size: PosterSize;
  width: number;
  height: number;
  rotated: boolean;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    flipX?: boolean;
    flipY?: boolean;
  };
  resizeMode?: "fit" | "fill" | "smart" | "center";
};

type PackedItem = PackItem & Rect;

const round = (value: number) => Math.round(value * 100) / 100;

export function generateLayout(
  posters: PosterInput[],
  mode: LayoutMode,
  settings: LayoutSettings
): LayoutResult {
  if (mode === "A4") return fixedA4(posters, settings);
  if (mode === "A5") return fixedGrid(posters, "A5", 2, 2, settings);
  if (mode === "A6") return fixedGrid(posters, "A6", 3, 3, settings);
  return mixedLayout(posters, settings);
}

export function posterLabel(size: PosterSize) {
  const paper = PAPER_MM[size];
  return `${size} ${paper.width} x ${paper.height} mm`;
}

function fixedA4(posters: PosterInput[], settings: LayoutSettings): LayoutResult {
  const used = posters.slice(0, 2);
  const landscapeCount = used.filter((poster) => poster.width > poster.height).length;
  const sheet =
    landscapeCount >= 2
      ? { width: PAPER_MM.A3.width, height: PAPER_MM.A3.height, orientation: "portrait" as const }
      : { width: PAPER_MM.A3.height, height: PAPER_MM.A3.width, orientation: "landscape" as const };
  const frame =
    sheet.orientation === "portrait"
      ? { width: PAPER_MM.A4.height, height: PAPER_MM.A4.width }
      : { width: PAPER_MM.A4.width, height: PAPER_MM.A4.height };
  const cols = sheet.orientation === "portrait" ? 1 : 2;
  const rows = sheet.orientation === "portrait" ? 2 : 1;
  const scale = gridScale(sheet, frame, cols, rows, settings);
  const startX = (sheet.width - (cols * frame.width * scale + (cols - 1) * settings.gapMm)) / 2;
  const startY = (sheet.height - (rows * frame.height * scale + (rows - 1) * settings.gapMm)) / 2;
  const placements = used.map((poster, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      id: poster.id,
      name: poster.name,
      size: "A4" as const,
      x: round(startX + col * (frame.width * scale + settings.gapMm)),
      y: round(startY + row * (frame.height * scale + settings.gapMm)),
      width: round(frame.width * scale),
      height: round(frame.height * scale),
      sourceIndex: index,
      rotated: sheet.orientation === "portrait",
      scale: round(scale),
      crop: poster.crop,
      resizeMode: poster.resizeMode
    };
  });

  return finalize("A4", sheet, placements, scale, settings, 2, posters.length);
}

function fixedGrid(
  posters: PosterInput[],
  size: PosterSize,
  cols: number,
  rows: number,
  settings: LayoutSettings
): LayoutResult {
  const used = posters.slice(0, cols * rows);
  const sheet = {
    width: PAPER_MM.A3.width,
    height: PAPER_MM.A3.height,
    orientation: "portrait" as const
  };
  const frame = PAPER_MM[size];
  const scale = gridScale(sheet, frame, cols, rows, settings);
  const gridWidth = cols * frame.width * scale + (cols - 1) * settings.gapMm;
  const gridHeight = rows * frame.height * scale + (rows - 1) * settings.gapMm;
  const startX = (sheet.width - gridWidth) / 2;
  const startY = (sheet.height - gridHeight) / 2;
  const placements = used.map((poster, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      id: poster.id,
      name: poster.name,
      size,
      x: round(startX + col * (frame.width * scale + settings.gapMm)),
      y: round(startY + row * (frame.height * scale + settings.gapMm)),
      width: round(frame.width * scale),
      height: round(frame.height * scale),
      sourceIndex: index,
      rotated: false,
      scale: round(scale),
      crop: poster.crop,
      resizeMode: poster.resizeMode
    };
  });
  return finalize(size, sheet, placements, scale, settings, cols * rows, posters.length);
}

function gridScale(
  sheet: { width: number; height: number },
  frame: { width: number; height: number },
  cols: number,
  rows: number,
  settings: LayoutSettings
) {
  const availableWidth = sheet.width - settings.marginMm * 2 - settings.gapMm * (cols - 1);
  const availableHeight = sheet.height - settings.marginMm * 2 - settings.gapMm * (rows - 1);
  return Math.max(0.1, Math.min(1, availableWidth / (cols * frame.width), availableHeight / (rows * frame.height)));
}

function mixedLayout(posters: PosterInput[], settings: LayoutSettings): LayoutResult {
  const warnings: string[] = [];
  if (!posters.length) {
    return finalize(
      "MIXED",
      { width: PAPER_MM.A3.width, height: PAPER_MM.A3.height, orientation: "portrait" },
      [],
      1,
      settings,
      undefined,
      0,
      ["Upload at least one poster for mixed layout."]
    );
  }

  const baseItems = posters.map((poster, index) => {
    const paper = PAPER_MM[poster.size];
    const preferLandscape = poster.width > poster.height;
    return {
      id: poster.id,
      name: poster.name,
      sourceIndex: index,
      size: poster.size,
      width: preferLandscape ? paper.height : paper.width,
      height: preferLandscape ? paper.width : paper.height,
      rotated: preferLandscape,
      crop: poster.crop,
      resizeMode: poster.resizeMode
    };
  });

  const sheets = [
    { width: PAPER_MM.A3.width, height: PAPER_MM.A3.height, orientation: "portrait" as const },
    { width: PAPER_MM.A3.height, height: PAPER_MM.A3.width, orientation: "landscape" as const }
  ];
  let best: {
    sheet: (typeof sheets)[number];
    placements: PackedItem[];
    scale: number;
  } | null = null;

  for (const sheet of sheets) {
    const variants = makeOrientationVariants(baseItems);
    for (const items of variants) {
      const packedAtFullSize = packItems(items, sheet.width, sheet.height, settings, 1);
      if (packedAtFullSize) {
        best = chooseBetter(best, { sheet, placements: packedAtFullSize, scale: 1 });
        continue;
      }

      let low = 0.45;
      let high = 0.99;
      let candidate: PackedItem[] | null = null;
      for (let i = 0; i < 14; i += 1) {
        const mid = (low + high) / 2;
        const packed = packItems(items, sheet.width, sheet.height, settings, mid);
        if (packed) {
          candidate = packed;
          low = mid;
        } else {
          high = mid;
        }
      }
      if (candidate) {
        best = chooseBetter(best, { sheet, placements: candidate, scale: low });
      }
    }
  }

  if (!best) {
    warnings.push("This combination cannot fit the A3 sheet with the current margin and gap.");
    return finalize(
      "MIXED",
      { width: PAPER_MM.A3.width, height: PAPER_MM.A3.height, orientation: "portrait" },
      [],
      1,
      settings,
      undefined,
      posters.length,
      warnings
    );
  }

  if (best.scale < 0.995) {
    warnings.push(`Mixed layout scaled to ${Math.round(best.scale * 100)}% to fit the selected posters.`);
  }

  const placements: Placement[] = best.placements.map((item) => ({
    id: item.id,
    name: item.name,
    size: item.size,
    x: round(item.x),
    y: round(item.y),
    width: round(item.width),
    height: round(item.height),
    sourceIndex: item.sourceIndex,
    rotated: item.rotated,
    scale: round(best.scale),
    crop: item.crop,
    resizeMode: item.resizeMode
  }));

  return finalize("MIXED", best.sheet, placements, best.scale, settings, undefined, posters.length, warnings);
}

function makeOrientationVariants(items: PackItem[]) {
  const variants: PackItem[][] = [];
  const cap = items.length > 10 ? 128 : 2048;

  const pushUnique = (next: PackItem[]) => {
    const key = next.map((item) => `${item.id}:${item.rotated ? 1 : 0}`).join("|");
    if (!variants.some((variant) => variant.map((item) => `${item.id}:${item.rotated ? 1 : 0}`).join("|") === key)) {
      variants.push(next);
    }
  };

  pushUnique(items);
  pushUnique(items.map((item) => rotateItem(item, false)));
  pushUnique(items.map((item) => rotateItem(item, true)));

  const walk = (index: number, current: PackItem[]) => {
    if (variants.length >= cap) return;
    if (index === items.length) {
      pushUnique(current);
      return;
    }
    const item = items[index];
    walk(index + 1, [...current, item]);
    walk(index + 1, [...current, rotateItem(item, !item.rotated)]);
  };

  if (items.length <= 10) walk(0, []);
  return variants;
}

function rotateItem(item: PackItem, rotated: boolean): PackItem {
  const paper = PAPER_MM[item.size];
  return {
    ...item,
    width: rotated ? paper.height : paper.width,
    height: rotated ? paper.width : paper.height,
    rotated
  };
}

function packItems(
  items: PackItem[],
  sheetWidth: number,
  sheetHeight: number,
  settings: LayoutSettings,
  scale: number
): PackedItem[] | null {
  const usable: Rect = {
    x: settings.marginMm,
    y: settings.marginMm,
    width: sheetWidth - settings.marginMm * 2,
    height: sheetHeight - settings.marginMm * 2
  };
  if (usable.width <= 0 || usable.height <= 0) return null;

  let freeRects: Rect[] = [usable];
  const packed: PackedItem[] = [];
  const ordered = [...items].sort((a, b) => b.width * b.height - a.width * a.height);

  for (const item of ordered) {
    const width = item.width * scale;
    const height = item.height * scale;
    const effectiveWidth = width + settings.gapMm;
    const effectiveHeight = height + settings.gapMm;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    freeRects.forEach((rect, index) => {
      if (effectiveWidth <= rect.width + 0.001 && effectiveHeight <= rect.height + 0.001) {
        const leftoverWidth = rect.width - effectiveWidth;
        const leftoverHeight = rect.height - effectiveHeight;
        const shortSide = Math.min(leftoverWidth, leftoverHeight);
        const longSide = Math.max(leftoverWidth, leftoverHeight);
        const score = shortSide * 1000 + longSide;
        if (score < bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
    });

    if (bestIndex === -1) return null;

    const free = freeRects[bestIndex];
    const usedWithGap: Rect = {
      x: free.x,
      y: free.y,
      width: effectiveWidth,
      height: effectiveHeight
    };
    packed.push({
      ...item,
      x: free.x,
      y: free.y,
      width,
      height
    });

    const nextFree: Rect[] = [];
    for (const rect of freeRects) {
      nextFree.push(...splitFreeRect(rect, usedWithGap));
    }
    freeRects = pruneFreeRects(nextFree);
  }

  return packed.sort((a, b) => a.sourceIndex - b.sourceIndex);
}

function splitFreeRect(free: Rect, used: Rect): Rect[] {
  if (!intersects(free, used)) return [free];
  const rects: Rect[] = [];
  const freeRight = free.x + free.width;
  const freeBottom = free.y + free.height;
  const usedRight = used.x + used.width;
  const usedBottom = used.y + used.height;

  if (used.y > free.y) {
    rects.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
  }
  if (usedBottom < freeBottom) {
    rects.push({ x: free.x, y: usedBottom, width: free.width, height: freeBottom - usedBottom });
  }
  if (used.x > free.x) {
    rects.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
  }
  if (usedRight < freeRight) {
    rects.push({ x: usedRight, y: free.y, width: freeRight - usedRight, height: free.height });
  }

  return rects.filter((rect) => rect.width > 0.1 && rect.height > 0.1);
}

function pruneFreeRects(rects: Rect[]) {
  const pruned: Rect[] = [];
  rects.forEach((rect, index) => {
    const contained = rects.some((other, otherIndex) => otherIndex !== index && contains(other, rect));
    if (!contained) pruned.push(rect);
  });
  return pruned.sort((a, b) => a.y - b.y || a.x - b.x);
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(a: Rect, b: Rect) {
  return (
    b.x >= a.x - 0.001 &&
    b.y >= a.y - 0.001 &&
    b.x + b.width <= a.x + a.width + 0.001 &&
    b.y + b.height <= a.y + a.height + 0.001
  );
}

function chooseBetter<T extends { scale: number; placements: PackedItem[]; sheet: { width: number; height: number } }>(
  current: T | null,
  candidate: T
): T {
  if (!current) return candidate;
  if (candidate.scale > current.scale + 0.002) return candidate;
  if (Math.abs(candidate.scale - current.scale) <= 0.002) {
    const currentWaste = boundingWaste(current.placements);
    const candidateWaste = boundingWaste(candidate.placements);
    if (candidateWaste < currentWaste) return candidate;
  }
  return current;
}

function boundingWaste(items: PackedItem[]) {
  if (!items.length) return Number.POSITIVE_INFINITY;
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const boundsArea = (right - left) * (bottom - top);
  const posterArea = items.reduce((sum, item) => sum + item.width * item.height, 0);
  return boundsArea - posterArea;
}

function finalize(
  mode: LayoutMode,
  sheet: { width: number; height: number; orientation: SheetOrientation },
  placements: Placement[],
  scale: number,
  settings: LayoutSettings,
  requiredCount?: number,
  inputCount?: number,
  extraWarnings: string[] = []
): LayoutResult {
  const posterArea = placements.reduce((sum, placement) => sum + placement.width * placement.height, 0);
  const sheetArea = sheet.width * sheet.height;
  const warnings = [...extraWarnings];

  if (requiredCount !== undefined && inputCount !== requiredCount) {
    warnings.push(`${mode} layout requires exactly ${requiredCount} images. Using ${placements.length} loaded image(s).`);
  }
  if (settings.marginMm > 0 && scale < 1 && mode !== "MIXED") {
    warnings.push("Selected margins or gaps require the fixed layout to be scaled down.");
  }
  if (mode === "A6" && scale < 1) {
    warnings.push("Nine true-size A6 posters cannot fit on A3; the 3 x 3 layout is scaled to fit.");
  }

  return {
    mode,
    sheet,
    placements,
    utilization: round((posterArea / sheetArea) * 100),
    posterArea: round(posterArea),
    sheetArea: round(sheetArea),
    scale: round(scale),
    requiredCount,
    isValid: requiredCount === undefined ? placements.length > 0 : inputCount === requiredCount,
    warnings
  };
}
