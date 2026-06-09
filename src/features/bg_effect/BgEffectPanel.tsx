import { useState, useCallback } from "react";
import { toast } from "sonner";
import { tempDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  bgRemoveImage,
  applyEffect,
  generatePreview,
  pickSavePath,
  formatExt,
  type ImageInfo,
} from "@/lib/invoke";
import { useAppStore } from "@/store/app";
import {
  Loader,
  Eraser,
  PaintBucket,
  CircleDashed,
  Coffee,
  Droplets,
  Diamond,
  Layers,
  Grid3x3,
  PenLine,
  Circle,
  Zap,
  RefreshCcw,
  Eye,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Effect catalogue ─────────────────────────────────────────────────────────

interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

interface EffectDef {
  key: string;
  label: string;
  icon: React.ElementType;
  params: ParamDef[];
}

const EFFECTS: EffectDef[] = [
  {
    key: "grayscale", label: "Grayscale", icon: CircleDashed,
    params: [{ key: "intensity", label: "Intensity", min: 0, max: 100, step: 1, default: 100, unit: "%" }],
  },
  {
    key: "sepia", label: "Sepia", icon: Coffee,
    params: [{ key: "intensity", label: "Intensity", min: 0, max: 100, step: 1, default: 80, unit: "%" }],
  },
  {
    key: "blur", label: "Blur", icon: Droplets,
    params: [{ key: "radius", label: "Radius", min: 0.5, max: 30, step: 0.5, default: 5 }],
  },
  {
    key: "sharpen", label: "Sharpen", icon: Diamond,
    params: [{ key: "strength", label: "Strength", min: 0.5, max: 8, step: 0.5, default: 2 }],
  },
  {
    key: "emboss", label: "Emboss", icon: Layers,
    params: [{ key: "strength", label: "Depth", min: 0.5, max: 5, step: 0.5, default: 2 }],
  },
  {
    key: "pixelate", label: "Pixelate", icon: Grid3x3,
    params: [{ key: "block_size", label: "Block Size", min: 2, max: 64, step: 2, default: 10, unit: "px" }],
  },
  {
    key: "sketch", label: "Sketch", icon: PenLine,
    params: [
      { key: "intensity",   label: "Intensity", min: 10, max: 100, step: 5,   default: 70, unit: "%" },
      { key: "blur_radius", label: "Blur",      min: 0.5, max: 10, step: 0.5, default: 3 },
    ],
  },
  {
    key: "vignette", label: "Vignette", icon: Circle,
    params: [
      { key: "radius",    label: "Radius",    min: 20, max: 90,  step: 5, default: 60, unit: "%" },
      { key: "intensity", label: "Intensity", min: 0,  max: 100, step: 5, default: 70, unit: "%" },
    ],
  },
  {
    key: "neon_edge", label: "Neon Edge", icon: Zap,
    params: [
      { key: "low_threshold",  label: "Low",  min: 5,  max: 100, step: 5,  default: 30 },
      { key: "high_threshold", label: "High", min: 30, max: 300, step: 10, default: 100 },
    ],
  },
  {
    key: "invert", label: "Invert", icon: RefreshCcw,
    params: [{ key: "intensity", label: "Mix", min: 0, max: 100, step: 1, default: 100, unit: "%" }],
  },
];

// ── Shared sub-components ────────────────────────────────────────────────────

function ParamRow({
  def,
  value,
  onChange,
}: {
  def: ParamDef;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] text-muted-foreground">{def.label}</Label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={def.min}
            max={def.max}
            step={def.step}
            value={value}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.min(def.max, Math.max(def.min, v)));
            }}
            className="h-7 w-20 text-xs text-right"
          />
          {def.unit && (
            <span className="w-4 text-[10px] text-muted-foreground">{def.unit}</span>
          )}
        </div>
      </div>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-primary"
      />
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

interface Props { image: ImageInfo }
type PanelMode = "background" | "effects";
type BgMode = "transparent" | "color";

function buildDefaults(): Record<string, number> {
  const m: Record<string, number> = {};
  for (const fx of EFFECTS) {
    for (const p of fx.params) m[`${fx.key}.${p.key}`] = p.default;
  }
  return m;
}

export function BgEffectPanel({ image }: Props) {
  const setCurrentImage = useAppStore(state => state.setCurrentImage);
  const setPreviewUrl   = useAppStore(state => state.setPreviewUrl);

  const [mode, setMode]       = useState<PanelMode>("background");
  const [busy, setBusy]       = useState(false);

  // Background state
  const [bgMode, setBgMode]       = useState<BgMode>("transparent");
  const [bgColor, setBgColor]     = useState("#ffffff");
  const [threshold, setThreshold] = useState(0.5);

  // Effects state
  const [selectedFx, setSelectedFx] = useState(EFFECTS[0].key);
  const [fxParams, setFxParams]     = useState<Record<string, number>>(buildDefaults);

  const activeFxDef = EFFECTS.find(e => e.key === selectedFx)!;

  const getParam = (fxKey: string, paramKey: string) =>
    fxParams[`${fxKey}.${paramKey}`] ??
    EFFECTS.find(e => e.key === fxKey)?.params.find(p => p.key === paramKey)?.default ??
    0;

  const setParam = (fxKey: string, paramKey: string, val: number) =>
    setFxParams(prev => ({ ...prev, [`${fxKey}.${paramKey}`]: val }));

  // ── Background: build bg_color helper ────────────────────────────────────
  function parseBgColor(): [number, number, number] | undefined {
    if (bgMode !== "color") return undefined;
    return [
      parseInt(bgColor.slice(1, 3), 16),
      parseInt(bgColor.slice(3, 5), 16),
      parseInt(bgColor.slice(5, 7), 16),
    ];
  }

  // ── Background Apply (preview only) ──────────────────────────────────────
  const handleBgApply = useCallback(async () => {
    setBusy(true);
    const tid = toast.loading("Generating preview…");
    try {
      const tmp = await tempDir();
      const ext = bgMode === "transparent" ? "png" : formatExt(image.format);
      const tmpPath = `${tmp}pixforge_bgpreview.${ext}`;
      await bgRemoveImage(image.path, tmpPath, {
        threshold,
        bg_mode: bgMode,
        bg_color: parseBgColor(),
      });
      const preview = await generatePreview(tmpPath, 1200);
      setPreviewUrl(preview);
      toast.success("Preview updated", { id: tid });
    } catch (e) {
      toast.error("Failed", { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, bgMode, bgColor, threshold, setPreviewUrl]);

  // ── Background Export (save file) ────────────────────────────────────────
  const handleBgExport = useCallback(async () => {
    const ext = bgMode === "transparent" ? "png" : formatExt(image.format);
    const dst = await pickSavePath(image.path, ext, "_nobg");
    if (!dst) return;

    setBusy(true);
    const tid = toast.loading("Removing background…");
    try {
      const r = await bgRemoveImage(image.path, dst, {
        threshold,
        bg_mode: bgMode,
        bg_color: parseBgColor(),
      });
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      toast.success("Background removed", {
        id: tid,
        description: `${r.info.width} × ${r.info.height}px`,
        action: { label: "Show", onClick: () => revealItemInDir(r.output_path) },
      });
    } catch (e) {
      toast.error("Failed", { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, bgMode, bgColor, threshold, setCurrentImage]);

  // ── Effect Apply (preview only) ──────────────────────────────────────────
  const handleEffectApply = useCallback(async () => {
    const params: Record<string, number> = {};
    for (const p of activeFxDef.params) params[p.key] = getParam(selectedFx, p.key);

    setBusy(true);
    const tid = toast.loading(`Previewing ${activeFxDef.label}…`);
    try {
      const tmp = await tempDir();
      const tmpPath = `${tmp}pixforge_fxpreview.png`;
      await applyEffect(image.path, tmpPath, { effect: selectedFx, params });
      const preview = await generatePreview(tmpPath, 1200);
      setPreviewUrl(preview);
      toast.success("Preview updated", { id: tid });
    } catch (e) {
      toast.error("Failed", { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, selectedFx, activeFxDef, fxParams, setPreviewUrl]);

  // ── Effect Export (save file) ─────────────────────────────────────────────
  const handleEffectExport = useCallback(async () => {
    const ext = formatExt(image.format);
    const dst = await pickSavePath(image.path, ext, `_${selectedFx}`);
    if (!dst) return;

    const params: Record<string, number> = {};
    for (const p of activeFxDef.params) params[p.key] = getParam(selectedFx, p.key);

    setBusy(true);
    const tid = toast.loading(`Applying ${activeFxDef.label}…`);
    try {
      const r = await applyEffect(image.path, dst, { effect: selectedFx, params });
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      toast.success("Effect applied", {
        id: tid,
        description: `${r.info.width} × ${r.info.height}px`,
        action: { label: "Show", onClick: () => revealItemInDir(r.output_path) },
      });
    } catch (e) {
      toast.error("Failed", { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, selectedFx, activeFxDef, fxParams, setCurrentImage]);

  // ── Action buttons row ────────────────────────────────────────────────────
  function ActionButtons({
    onApply,
    onExport,
  }: {
    onApply: () => void;
    onExport: () => void;
  }) {
    return (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={busy}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-accent text-sm font-medium text-foreground transition-colors hover:bg-accent/80 disabled:opacity-50"
        >
          {busy ? <Loader size={13} className="animate-spin" /> : <Eye size={13} strokeWidth={1.5} />}
          Apply
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={busy}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader size={13} className="animate-spin" /> : <Download size={13} strokeWidth={1.5} />}
          Export
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">BgEffect</h2>

      {/* Mode tabs */}
      <div className="flex overflow-hidden rounded-lg border border-border">
        {(["background", "effects"] as PanelMode[]).map((m, i) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 py-1.5 text-xs font-medium capitalize transition-colors",
              i === 0 && "border-r border-border",
              mode === m
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m === "background" ? "Background" : "Effects"}
          </button>
        ))}
      </div>

      {/* ─ Background section ─────────────────────────────────────────────── */}
      {mode === "background" && (
        <div className="flex flex-col gap-4">
          {/* Output mode */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Output Mode</Label>
            <div className="flex gap-1.5">
              {([
                { id: "transparent" as BgMode, icon: Eraser,      label: "Transparent" },
                { id: "color"       as BgMode, icon: PaintBucket, label: "Fill Color"  },
              ]).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBgMode(id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs transition-colors hover:bg-accent",
                    bgMode === id && "border-primary bg-accent text-accent-foreground"
                  )}
                >
                  <Icon size={13} strokeWidth={1.5} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          {bgMode === "color" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Background Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor}
                  onChange={e => setBgColor(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {bgColor.toUpperCase()}
                </span>
              </div>
            </div>
          )}

          {/* Threshold */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">Threshold</Label>
              <Input
                type="number"
                min={0.01}
                max={0.99}
                step={0.01}
                value={threshold}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) setThreshold(Math.min(0.99, Math.max(0.01, v)));
                }}
                className="h-7 w-20 text-xs text-right"
              />
            </div>
            <input
              type="range"
              min={0.01}
              max={0.99}
              step={0.01}
              value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              className="h-1.5 w-full cursor-pointer accent-primary"
            />
            <p className="text-[10px] text-muted-foreground">
              Higher value = stricter foreground detection
            </p>
          </div>

          {/* Model badge */}
          <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground">
              Model: silueta.onnx (43 MB) · First run loads model ~2 s
            </p>
          </div>

          <ActionButtons onApply={handleBgApply} onExport={handleBgExport} />
        </div>
      )}

      {/* ─ Effects section ────────────────────────────────────────────────── */}
      {mode === "effects" && (
        <div className="flex flex-col gap-4">
          {/* Effect grid 5 × 2 */}
          <div className="grid grid-cols-5 gap-1">
            {EFFECTS.map(fx => {
              const Icon = fx.icon;
              return (
                <button
                  key={fx.key}
                  type="button"
                  onClick={() => setSelectedFx(fx.key)}
                  title={fx.label}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground",
                    selectedFx === fx.key &&
                      "border-primary bg-accent text-accent-foreground"
                  )}
                >
                  <Icon size={15} strokeWidth={1.5} />
                  <span className="text-[9px] leading-none">{fx.label}</span>
                </button>
              );
            })}
          </div>

          {/* Parameters for selected effect */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-xs font-medium">{activeFxDef.label}</p>
            {activeFxDef.params.map(paramDef => (
              <ParamRow
                key={paramDef.key}
                def={paramDef}
                value={getParam(selectedFx, paramDef.key)}
                onChange={val => setParam(selectedFx, paramDef.key, val)}
              />
            ))}
          </div>

          <ActionButtons onApply={handleEffectApply} onExport={handleEffectExport} />
        </div>
      )}
    </div>
  );
}
