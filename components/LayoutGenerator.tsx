"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FileDown,
  FileImage,
  Grid2X2,
  Grid3X3,
  ImageDown,
  Layers3,
  Ruler,
  Scissors,
  Settings2,
  Trash2,
  UploadCloud,
  Wand2,
  Crop,
  RotateCw,
  Plus,
  Hand,
  Maximize2,
  Sun,
  Moon
} from "lucide-react";
import { downloadPdf, downloadRaster } from "@/lib/exportLayout";
import { generateLayout, PAPER_MM, posterLabel, type LayoutMode, type LayoutSettings, type PosterInput, type PosterSize, type Placement } from "@/lib/printLayout";
import { loadImage } from "@/lib/imageTools";
import CropModal from "./CropModal";

const SheetPreview = dynamic(() => import("./SheetPreview"), {
  ssr: false,
  loading: () => <div className="flex aspect-[297/420] items-center justify-center rounded-md border border-line bg-panelSoft text-sm text-paper/60">Loading preview</div>
});

type UploadedPoster = PosterInput & {
  file: File;
};

const MODES: Array<{ id: LayoutMode; label: string; icon: typeof Grid2X2; count?: number; accent: string }> = [
  { id: "A4", label: "A4 Layout", icon: Ruler, count: 2, accent: "text-ember" },
  { id: "A5", label: "A5 Layout", icon: Grid2X2, count: 4, accent: "text-mint" },
  { id: "A6", label: "A6 Layout", icon: Grid3X3, count: 9, accent: "text-brass" },
  { id: "MIXED", label: "Mixed Layout", icon: Layers3, accent: "text-paper" }
];

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function LayoutGenerator() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as "dark" | "light" | null;
    const initialTheme = savedTheme || "dark";
    setTheme(initialTheme);
    if (initialTheme === "light") {
      document.body.classList.add("light-mode");
    } else {
      document.body.classList.remove("light-mode");
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    if (nextTheme === "light") {
      document.body.classList.add("light-mode");
    } else {
      document.body.classList.remove("light-mode");
    }
  };

  const [posters, setPosters] = useState<UploadedPoster[]>([]);
  const [mode, setMode] = useState<LayoutMode>("MIXED");
  const [settings, setSettings] = useState<LayoutSettings>({
    gapMm: 1,
    marginMm: 3,
    cutMarks: true,
    bleed: false,
    cmyk: false
  });
  const [dropActive, setDropActive] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "jpg" | "png" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Desktop Manual Layout states
  const [manualMode, setManualMode] = useState(false);
  const [manualPlacements, setManualPlacements] = useState<Placement[]>([]);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [cropModalPosterId, setCropModalPosterId] = useState<string | null>(null);

  const autoLayout = useMemo(() => generateLayout(posters, mode, settings), [posters, mode, settings]);

  const layout = useMemo(() => {
    if (manualMode) {
      const posterArea = manualPlacements.reduce((sum, p) => sum + p.width * p.height, 0);
      const sheetArea = autoLayout.sheet.width * autoLayout.sheet.height;
      return {
        ...autoLayout,
        placements: manualPlacements,
        utilization: Math.round((posterArea / sheetArea) * 100),
        posterArea,
        isValid: manualPlacements.length > 0
      };
    }
    return autoLayout;
  }, [autoLayout, manualMode, manualPlacements]);

  // Track the currently selected poster on the manual canvas
  const selectedPoster = useMemo(() => {
    if (!selectedPlacementId) return null;
    const pl = layout.placements.find((p) => p.id === selectedPlacementId);
    if (!pl) return null;
    return posters[pl.sourceIndex] || null;
  }, [selectedPlacementId, layout.placements, posters]);

  const fixedRequirement = MODES.find((item) => item.id === mode)?.count;
  const ready = layout.placements.length > 0 && (fixedRequirement === undefined || posters.length === fixedRequirement);

  // Toggle manual layout mode, cloning current auto layout on enable
  function toggleManualMode() {
    if (!manualMode) {
      setManualPlacements(autoLayout.placements);
      setSelectedPlacementId(null);
    }
    setManualMode(!manualMode);
  }

  // Update poster crop settings
  function updatePosterCrop(id: string, crop: { x: number; y: number; width: number; height: number; rotation: number }) {
    setPosters((current) =>
      current.map((p) => (p.id === id ? { ...p, crop } : p))
    );
    setManualPlacements((current) =>
      current.map((p) => {
        const posterIdx = posters.findIndex((x) => x.id === id);
        if (p.sourceIndex === posterIdx) {
          return { ...p, crop };
        }
        return p;
      })
    );
  }

  // Update poster resize mode
  function updatePosterResizeMode(id: string, resizeMode: "fit" | "fill" | "smart" | "center") {
    setPosters((current) =>
      current.map((p) => (p.id === id ? { ...p, resizeMode } : p))
    );
    setManualPlacements((current) =>
      current.map((p) => {
        const posterIdx = posters.findIndex((x) => x.id === id);
        if (p.sourceIndex === posterIdx) {
          return { ...p, resizeMode };
        }
        return p;
      })
    );
  }

  // Add a poster manually to the canvas in manual mode
  function addPosterToCanvas(posterId: string) {
    if (!manualMode) return;
    const posterIndex = posters.findIndex((p) => p.id === posterId);
    if (posterIndex === -1) return;
    const poster = posters[posterIndex];
    const paper = PAPER_MM[poster.size];

    const newPlacement: Placement = {
      id: crypto.randomUUID(),
      name: poster.name,
      size: poster.size,
      x: settings.marginMm + 5,
      y: settings.marginMm + 5,
      width: paper.width,
      height: paper.height,
      sourceIndex: posterIndex,
      rotated: false,
      scale: 1,
      crop: poster.crop,
      resizeMode: poster.resizeMode
    };

    setManualPlacements((current) => [...current, newPlacement]);
    setSelectedPlacementId(newPlacement.id);
  }

  // Rotate selected placement by 90 degrees
  function rotateSelectedPlacement() {
    if (!selectedPlacementId) return;
    setManualPlacements((current) =>
      current.map((p) =>
        p.id === selectedPlacementId
          ? {
              ...p,
              rotated: !p.rotated,
              width: p.height,
              height: p.width
            }
          : p
      )
    );
  }

  // Delete selected placement in manual mode
  function deleteSelectedPlacement() {
    if (!selectedPlacementId) return;
    setManualPlacements((current) => current.filter((p) => p.id !== selectedPlacementId));
    setSelectedPlacementId(null);
  }

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => ACCEPTED_TYPES.has(file.type));
    if (!files.length) {
      setMessage("Upload JPG, JPEG, PNG, or WEBP files.");
      return;
    }

    const next = await Promise.all(
      files.map(async (file) => {
        const url = URL.createObjectURL(file);
        try {
          const image = await loadImage(url);
          return {
            id: crypto.randomUUID(),
            name: file.name,
            width: image.naturalWidth,
            height: image.naturalHeight,
            size: defaultSizeForImage(image.naturalWidth, image.naturalHeight),
            url,
            file
          } satisfies UploadedPoster;
        } catch {
          URL.revokeObjectURL(url);
          return null;
        }
      })
    );

    const valid = next.filter(Boolean) as UploadedPoster[];
    setPosters((current) => [...current, ...valid]);
    setMessage(valid.length ? `${valid.length} image(s) added.` : "No readable images found.");
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    void addFiles(event.dataTransfer.files);
  }

  function removePoster(id: string) {
    setPosters((current) => {
      const target = current.find((poster) => poster.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((poster) => poster.id !== id);
    });
  }

  function movePoster(index: number, direction: -1 | 1) {
    setPosters((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function updatePosterSize(id: string, size: PosterSize) {
    setPosters((current) => current.map((poster) => (poster.id === id ? { ...poster, size } : poster)));
  }

  async function runExport(kind: "pdf" | "jpg" | "png") {
    if (!ready) {
      setMessage(fixedRequirement ? `${mode} layout needs exactly ${fixedRequirement} images.` : "Upload at least one image.");
      return;
    }
    setBusy(kind);
    setMessage(null);
    try {
      if (settings.cmyk) {
        await downloadFromBackend(kind, layout, posters, settings);
        setMessage(`${kind.toUpperCase()} generated by the CMYK-ready backend.`);
      } else {
        if (kind === "pdf") await downloadPdf(layout, posters, settings);
        if (kind === "jpg") await downloadRaster(layout, posters, settings, "jpeg");
        if (kind === "png") await downloadRaster(layout, posters, settings, "png");
        setMessage(kind === "pdf" ? "PDF generated at 300 DPI." : `${kind.toUpperCase()} preview downloaded.`);
      }
    } catch (error) {
      if (settings.cmyk) {
        setMessage("Start the FastAPI backend on port 8000 for CMYK-ready export.");
      } else {
        setMessage(error instanceof Error ? error.message : "Export failed.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen">
      <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={onInputChange} />

      <header className="border-b border-line bg-ink/86 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brass">Poster Kadai</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-normal text-paper sm:text-3xl">Print Layout Generator</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-md border border-paper/16 bg-panelSoft text-paper/80 hover:border-paper/20 hover:bg-panelSoft/80 hover:text-paper transition"
                title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
                aria-label="Toggle Theme"
              >
                {theme === "dark" ? <Sun className="h-4 w-4 text-ember" /> : <Moon className="h-4 w-4 text-brass" />}
              </button>
              <button
                type="button"
                onClick={toggleManualMode}
                disabled={posters.length === 0}
                className={clsx(
                  "inline-flex items-center justify-center gap-2 rounded-md border border-paper/16 px-4 py-2.5 font-medium transition disabled:opacity-40 disabled:cursor-not-allowed",
                  manualMode
                    ? "bg-ember text-paper border-ember hover:bg-ember/90 shadow-glow"
                    : "bg-panelSoft text-paper/80 hover:border-paper/20 hover:bg-panelSoft/80 hover:text-paper"
                )}
              >
                <Hand className="h-4 w-4" />
                <span>{manualMode ? "Auto Layout Mode" : "Manual Layout Mode"}</span>
              </button>
              <ActionButton icon={UploadCloud} label="Upload Images" onClick={() => inputRef.current?.click()} />
              <ActionButton icon={FileDown} label="Generate PDF" disabled={!ready || busy !== null} loading={busy === "pdf"} onClick={() => void runExport("pdf")} />
              <ActionButton icon={Download} label="Download Preview" disabled={!ready || busy !== null} loading={busy === "jpg"} onClick={() => void runExport("jpg")} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                className={clsx(
                  "flex items-center justify-between rounded-md border px-3 py-3 text-left transition",
                  mode === item.id ? "border-ember bg-ember/12 text-paper shadow-glow" : "border-line bg-panel hover:border-paper/30 hover:bg-panelSoft"
                )}
              >
                <span className="flex items-center gap-3">
                  <item.icon className={clsx("h-5 w-5", item.accent)} />
                  <span className="font-medium">{item.label}</span>
                </span>
                {item.count ? <span className="text-xs text-paper/55">{item.count} images</span> : <span className="text-xs text-mint">auto-pack</span>}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)_330px] lg:px-8">
        <aside className="space-y-5">
          <section className="rounded-md border border-line bg-panel p-4">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={onDrop}
              className={clsx(
                "flex min-h-[168px] cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed px-4 text-center transition",
                dropActive ? "border-mint bg-mint/10" : "border-paper/20 bg-ink/30 hover:border-ember/80"
              )}
              onClick={() => inputRef.current?.click()}
            >
              <UploadCloud className="h-9 w-9 text-ember" />
              <div>
                <p className="font-medium text-paper">Upload Images</p>
                <p className="mt-1 text-sm text-paper/58">JPG, JPEG, PNG, WEBP</p>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <FileImage className="h-4 w-4 text-mint" />
                <h2 className="font-medium text-paper">Uploaded Posters</h2>
              </div>
              <span className="text-sm text-paper/55">{posters.length}</span>
            </div>
            <div className="max-h-[520px] space-y-3 overflow-auto p-3 scrollbar-thin">
              {posters.length === 0 ? (
                <div className="rounded-md border border-line bg-ink/35 px-4 py-6 text-center text-sm text-paper/58">No images loaded</div>
              ) : (
                posters.map((poster, index) => (
                  <article key={poster.id} className="rounded-md border border-line bg-panelSoft p-3">
                    <div className="flex gap-3">
                      <img src={poster.url} alt={poster.name} className="h-20 w-16 rounded object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-paper" title={poster.name}>{poster.name}</p>
                        <p className="mt-0.5 text-[10px] text-paper/55">
                          {poster.width} x {poster.height}px
                        </p>
                        {mode === "MIXED" ? (
                          <div className="mt-2">
                            <label className="text-[9px] uppercase tracking-wider text-paper/40 font-semibold block mb-0.5">Size Preset</label>
                            <select
                              value={poster.size}
                              onChange={(event) => updatePosterSize(poster.id, event.target.value as PosterSize)}
                              className="w-full rounded border border-line bg-ink px-2 py-1 text-xs text-paper"
                            >
                              <option value="A4">{posterLabel("A4")}</option>
                              <option value="A5">{posterLabel("A5")}</option>
                              <option value="A6">{posterLabel("A6")}</option>
                            </select>
                          </div>
                        ) : (
                          <p className="mt-1 text-[11px] text-brass font-medium">{mode} frame selected</p>
                        )}

                        <div className="mt-2">
                          <label className="text-[9px] uppercase tracking-wider text-paper/40 font-semibold block mb-0.5">Resize Tool</label>
                          <select
                            value={poster.resizeMode || "fill"}
                            onChange={(event) => updatePosterResizeMode(poster.id, event.target.value as any)}
                            className="w-full rounded border border-line bg-ink px-2 py-1 text-xs text-paper/90"
                          >
                            <option value="fill">Fill (Center Crop)</option>
                            <option value="fit">Fit (Letterbox)</option>
                            <option value="smart">Smart Crop (Auto)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {manualMode && (
                      <button
                        type="button"
                        onClick={() => addPosterToCanvas(poster.id)}
                        className="mt-2.5 flex items-center justify-center gap-1 w-full rounded border border-ember/30 bg-ember/10 hover:bg-ember/20 text-ember px-2 py-1 text-xs font-medium transition"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Place on Canvas</span>
                      </button>
                    )}

                    <div className="mt-3 flex items-center justify-between border-t border-line/40 pt-2">
                      <div className="flex gap-1">
                        <IconButton label="Move up" disabled={index === 0} onClick={() => movePoster(index, -1)} icon={ArrowUp} />
                        <IconButton label="Move down" disabled={index === posters.length - 1} onClick={() => movePoster(index, 1)} icon={ArrowDown} />
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCropModalPosterId(poster.id)}
                          className="inline-flex items-center gap-1 rounded border border-line bg-ink/30 px-2.5 py-1 text-xs text-paper/85 hover:bg-ink hover:text-paper transition"
                        >
                          <Crop className="h-3.5 w-3.5" />
                          <span>Crop Tool</span>
                        </button>
                        <IconButton label="Delete image" onClick={() => removePoster(poster.id)} icon={Trash2} tone="danger" />
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="min-w-0 rounded-md border border-line bg-panel p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-paper">A3 Sheet Preview</h2>
              <p className="mt-1 text-sm text-paper/56">
                {layout.sheet.width} x {layout.sheet.height} mm, {layout.sheet.orientation}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton icon={ImageDown} label="PNG Preview" disabled={!ready || busy !== null} loading={busy === "png"} onClick={() => void runExport("png")} compact />
              <ActionButton icon={Download} label="JPG Preview" disabled={!ready || busy !== null} loading={busy === "jpg"} onClick={() => void runExport("jpg")} compact />
            </div>
          </div>

          {manualMode && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-md bg-ink/30 border border-line/60 p-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-paper/40 uppercase tracking-wider ml-1">Canvas Tools</span>

                {selectedPoster ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setCropModalPosterId(selectedPoster.id)}
                      className="inline-flex items-center gap-1.5 rounded border border-line bg-panel px-3 py-1.5 text-xs text-paper hover:bg-panelSoft transition"
                    >
                      <Crop className="h-3.5 w-3.5" />
                      <span>Crop Image</span>
                    </button>

                    <div className="flex items-center gap-2 border-l border-line/50 pl-3">
                      <span className="text-xs text-paper/50 font-medium">Resize:</span>
                      <select
                        value={selectedPoster.resizeMode || "fill"}
                        onChange={(event) => updatePosterResizeMode(selectedPoster.id, event.target.value as any)}
                        className="rounded border border-line bg-panel px-2 py-1 text-xs text-paper/90"
                      >
                        <option value="fill">Fill (Center Crop)</option>
                        <option value="fit">Fit (Letterbox)</option>
                        <option value="smart">Smart Crop (Auto)</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={rotateSelectedPlacement}
                      className="inline-flex items-center gap-1.5 rounded border border-line bg-panel px-3 py-1.5 text-xs text-paper/80 hover:bg-panelSoft transition"
                      title="Rotate selected poster 90 degrees"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span>Rotate</span>
                    </button>

                    <button
                      type="button"
                      onClick={deleteSelectedPlacement}
                      className="inline-flex items-center gap-1.5 rounded border border-ember/30 bg-ember/10 px-3 py-1.5 text-xs text-ember hover:bg-ember/20 transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete</span>
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-paper/40 italic">Select a poster on canvas to edit or crop</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-paper/60">Place another copy:</span>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      addPosterToCanvas(e.target.value);
                      e.target.value = "";
                    }
                  }}
                  className="rounded border border-line bg-panel px-2 py-1.5 text-xs text-paper max-w-[130px]"
                  defaultValue=""
                >
                  <option value="" disabled>Choose...</option>
                  {posters.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <SheetPreview
            layout={layout}
            posters={posters}
            settings={settings}
            manualMode={manualMode}
            onUpdatePlacements={setManualPlacements}
            selectedPlacementId={selectedPlacementId}
            onSelectPlacement={setSelectedPlacementId}
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric label="Posters used" value={`${layout.placements.length}/${mode === "MIXED" ? posters.length : fixedRequirement ?? posters.length}`} />
            <Metric label="Paper utilization" value={`${layout.utilization}%`} />
            <Metric label="Output" value="300 DPI" />
          </div>

          {(layout.warnings.length > 0 || message) && (
            <div className="mt-4 space-y-2">
              {layout.warnings.map((warning) => (
                <Notice key={warning} tone={layout.isValid ? "warn" : "error"} text={warning} />
              ))}
              {message ? <Notice tone={message.includes("generated") || message.includes("downloaded") || message.includes("added") ? "ok" : "warn"} text={message} /> : null}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="rounded-md border border-line bg-panel p-4">
            <div className="mb-4 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-brass" />
              <h2 className="font-medium text-paper">Print Controls</h2>
            </div>
            <ControlGroup label="Gap between posters" value={`${settings.gapMm} mm`}>
              <SegmentedNumber
                value={settings.gapMm}
                presets={[0, 1, 2]}
                max={10}
                onChange={(gapMm) => setSettings((current) => ({ ...current, gapMm }))}
              />
            </ControlGroup>
            <ControlGroup label="Outer margin" value={`${settings.marginMm} mm`}>
              <SegmentedNumber
                value={settings.marginMm}
                presets={[0, 3, 5]}
                max={20}
                onChange={(marginMm) => setSettings((current) => ({ ...current, marginMm }))}
              />
            </ControlGroup>
            <div className="space-y-3 pt-2">
              <Toggle icon={Scissors} label="Cut marks" checked={settings.cutMarks} onChange={(cutMarks) => setSettings((current) => ({ ...current, cutMarks }))} />
              <Toggle icon={Wand2} label="Bleed" checked={settings.bleed} onChange={(bleed) => setSettings((current) => ({ ...current, bleed }))} />
              <Toggle icon={CheckCircle2} label="CMYK-ready" checked={settings.cmyk} onChange={(cmyk) => setSettings((current) => ({ ...current, cmyk }))} />
            </div>
          </section>

          <section className="rounded-md border border-line bg-panel p-4">
            <h2 className="font-medium text-paper">Poster Dimensions</h2>
            <div className="mt-4 space-y-2 text-sm">
              {layout.placements.length ? (
                layout.placements.map((placement) => (
                  <div key={placement.id} className="flex items-center justify-between rounded bg-ink/42 px-3 py-2">
                    <span className="truncate pr-3 text-paper/70">{placement.name}</span>
                    <span className="shrink-0 text-paper">
                      {Math.round(placement.width)} x {Math.round(placement.height)} mm
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded bg-ink/42 px-3 py-4 text-center text-paper/55">No layout yet</div>
              )}
            </div>
          </section>

          <section className="rounded-md border border-line bg-panel p-4">
            <h2 className="font-medium text-paper">Production Notes</h2>
            <div className="mt-4 space-y-3 text-sm text-paper/66">
              <p>A3 base size: {PAPER_MM.A3.width} x {PAPER_MM.A3.height} mm.</p>
              <p>Images are center-cropped to frame ratio and never stretched.</p>
              <p>CMYK-ready export uses the FastAPI renderer with Pillow/OpenCV and ReportLab.</p>
            </div>
          </section>
        </aside>
      </div>

      {cropModalPosterId && (
        <CropModal
          isOpen={cropModalPosterId !== null}
          onClose={() => setCropModalPosterId(null)}
          imageUrl={posters.find((p) => p.id === cropModalPosterId)?.url || ""}
          imageName={posters.find((p) => p.id === cropModalPosterId)?.name || ""}
          aspectPreset={
            (() => {
              const p = posters.find((p) => p.id === cropModalPosterId);
              if (!p) return "free";
              return p.size === "A4" || p.size === "A5" || p.size === "A6" ? p.size : "free";
            })()
          }
          currentCrop={posters.find((p) => p.id === cropModalPosterId)?.crop}
          onSave={(crop) => {
            updatePosterCrop(cropModalPosterId, crop);
            setCropModalPosterId(null);
          }}
        />
      )}
    </main>
  );
}

async function downloadFromBackend(
  kind: "pdf" | "jpg" | "png",
  layout: ReturnType<typeof generateLayout>,
  posters: UploadedPoster[],
  settings: LayoutSettings
) {
  const formData = new FormData();
  formData.append("layout_json", JSON.stringify(layout));
  formData.append("settings_json", JSON.stringify(settings));
  formData.append("output_format", kind);
  posters.forEach((poster) => formData.append("files", poster.file, poster.name));

  const response = await fetch("http://127.0.0.1:8000/api/render", {
    method: "POST",
    body: formData
  });
  if (!response.ok) throw new Error("Backend export failed.");

  const blob = await response.blob();
  const extension = kind === "jpg" ? "jpg" : kind;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `poster-kadai-${layout.mode.toLowerCase()}-a3.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function defaultSizeForImage(width: number, height: number): PosterSize {
  if (width * height > 6_000_000) return "A4";
  return width > height ? "A5" : "A6";
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  loading,
  compact
}: {
  icon: typeof UploadCloud;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md border border-paper/16 bg-paper px-4 font-medium text-ink transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45",
        compact ? "py-2 text-sm" : "py-2.5"
      )}
      title={label}
    >
      <Icon className="h-4 w-4" />
      <span>{loading ? "Working" : label}</span>
    </button>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = "neutral"
}: {
  icon: typeof ArrowUp;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        "inline-flex h-8 w-8 items-center justify-center rounded border transition disabled:cursor-not-allowed disabled:opacity-35",
        tone === "danger" ? "border-ember/40 bg-ember/10 text-ember hover:bg-ember/18" : "border-line bg-ink/35 text-paper/78 hover:bg-ink"
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-panelSoft px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-paper/45">{label}</p>
      <p className="mt-2 text-xl font-semibold text-paper">{value}</p>
    </div>
  );
}

function Notice({ tone, text }: { tone: "ok" | "warn" | "error"; text: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      className={clsx(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        tone === "ok" && "border-mint/30 bg-mint/10 text-mint",
        tone === "warn" && "border-brass/35 bg-brass/10 text-brass",
        tone === "error" && "border-ember/35 bg-ember/10 text-ember"
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function ControlGroup({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line py-4 first:pt-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm text-paper/64">{label}</span>
        <span className="rounded bg-ink px-2 py-1 text-xs text-paper">{value}</span>
      </div>
      {children}
    </div>
  );
}

function SegmentedNumber({
  value,
  presets,
  max,
  onChange
}: {
  value: number;
  presets: number[];
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={clsx(
              "rounded-md border px-2 py-2 text-sm transition",
              value === preset ? "border-ember bg-ember/15 text-paper" : "border-line bg-ink/35 text-paper/70 hover:bg-ink"
            )}
          >
            {preset} mm
          </button>
        ))}
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(event) => onChange(Math.max(0, Math.min(max, Number(event.target.value) || 0)))}
          className="rounded-md border border-line bg-ink px-2 py-2 text-sm text-paper"
          aria-label="Custom millimeters"
        />
      </div>
      <input
        className="range-control w-full"
        type="range"
        min={0}
        max={max}
        step={0.5}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function Toggle({
  icon: Icon,
  label,
  checked,
  onChange
}: {
  icon: typeof Scissors;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-line bg-ink/35 px-3 py-3">
      <span className="flex items-center gap-2 text-sm text-paper">
        <Icon className="h-4 w-4 text-paper/58" />
        {label}
      </span>
      <input type="checkbox" className="h-4 w-4 accent-ember" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
