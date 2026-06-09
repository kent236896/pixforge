import { useState, useCallback } from "react";
import { toast } from "sonner";
import { tempDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  bgRemoveImage, applyEffect, generatePreview, pickSavePath, formatExt, type ImageInfo,
} from "@/lib/invoke";
import { useAppStore } from "@/store/app";
import { useT } from "@/lib/i18n";
import {
  Loader, Eraser, PaintBucket, CircleDashed, Coffee, Droplets, Diamond,
  Layers, Grid3x3, PenLine, Circle, Zap, RefreshCcw, Eye, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Effect catalogue ─────────────────────────────────────────────────────────

interface ParamDef {
  key: string;
  paramLabelKey: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

interface EffectDef {
  key: string;
  labelKey: string;
  icon: React.ElementType;
  params: ParamDef[];
}

const EFFECTS: EffectDef[] = [
  {
    key: "grayscale", labelKey: "bgeffect.fx.grayscale", icon: CircleDashed,
    params: [{ key: "intensity", paramLabelKey: "bgeffect.param.intensity", min: 0, max: 100, step: 1, default: 100, unit: "%" }],
  },
  {
    key: "sepia", labelKey: "bgeffect.fx.sepia", icon: Coffee,
    params: [{ key: "intensity", paramLabelKey: "bgeffect.param.intensity", min: 0, max: 100, step: 1, default: 80, unit: "%" }],
  },
  {
    key: "blur", labelKey: "bgeffect.fx.blur", icon: Droplets,
    params: [{ key: "radius", paramLabelKey: "bgeffect.param.radius", min: 0.5, max: 30, step: 0.5, default: 5 }],
  },
  {
    key: "sharpen", labelKey: "bgeffect.fx.sharpen", icon: Diamond,
    params: [{ key: "strength", paramLabelKey: "bgeffect.param.strength", min: 0.5, max: 8, step: 0.5, default: 2 }],
  },
  {
    key: "emboss", labelKey: "bgeffect.fx.emboss", icon: Layers,
    params: [{ key: "strength", paramLabelKey: "bgeffect.param.depth", min: 0.5, max: 5, step: 0.5, default: 2 }],
  },
  {
    key: "pixelate", labelKey: "bgeffect.fx.pixelate", icon: Grid3x3,
    params: [{ key: "block_size", paramLabelKey: "bgeffect.param.block_size", min: 2, max: 64, step: 2, default: 10, unit: "px" }],
  },
  {
    key: "sketch", labelKey: "bgeffect.fx.sketch", icon: PenLine,
    params: [
      { key: "intensity",   paramLabelKey: "bgeffect.param.intensity",  min: 10, max: 100, step: 5,   default: 70, unit: "%" },
      { key: "blur_radius", paramLabelKey: "bgeffect.param.blur_radius", min: 0.5, max: 10, step: 0.5, default: 3 },
    ],
  },
  {
    key: "vignette", labelKey: "bgeffect.fx.vignette", icon: Circle,
    params: [
      { key: "radius",    paramLabelKey: "bgeffect.param.radius",    min: 20, max: 90,  step: 5, default: 60, unit: "%" },
      { key: "intensity", paramLabelKey: "bgeffect.param.intensity", min: 0,  max: 100, step: 5, default: 70, unit: "%" },
    ],
  },
  {
    key: "neon_edge", labelKey: "bgeffect.fx.neon_edge", icon: Zap,
    params: [
      { key: "low_threshold",  paramLabelKey: "bgeffect.param.low_threshold",  min: 5,  max: 100, step: 5,  default: 30 },
      { key: "high_threshold", paramLabelKey: "bgeffect.param.high_threshold", min: 30, max: 300, step: 10, default: 100 },
    ],
  },
  {
    key: "invert", labelKey: "bgeffect.fx.invert", icon: RefreshCcw,
    params: [{ key: "intensity", paramLabelKey: "bgeffect.param.mix", min: 0, max: 100, step: 1, default: 100, unit: "%" }],
  },
];

// ── Shared sub-components ────────────────────────────────────────────────────

function ParamRow({
  def, value, onChange,
}: {
  def: ParamDef; value: number; onChange: (v: number) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] text-muted-foreground">{t(def.paramLabelKey)}</Label>
        <div className="flex items-center gap-1">
          <Input
            type="number" min={def.min} max={def.max} step={def.step}
            value={value}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.min(def.max, Math.max(def.min, v)));
            }}
            aria-label={t(def.paramLabelKey)}
            className="h-7 w-20 text-xs text-right"
          />
          {def.unit && <span className="w-4 text-[10px] text-muted-foreground">{def.unit}</span>}
        </div>
      </div>
      <input
        type="range" min={def.min} max={def.max} step={def.step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        aria-label={t(def.paramLabelKey)}
        className="h-1.5 w-full cursor-pointer accent-primary"
      />
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

interface Props { image: ImageInfo }
type PanelMode = "background" | "effects";
type BgMode    = "transparent" | "color";

function buildDefaults(): Record<string, number> {
  const m: Record<string, number> = {};
  for (const fx of EFFECTS) {
    for (const p of fx.params) m[`${fx.key}.${p.key}`] = p.default;
  }
  return m;
}

export function BgEffectPanel({ image }: Props) {
  const t = useT();
  const setCurrentImage = useAppStore(state => state.setCurrentImage);
  const setPreviewUrl   = useAppStore(state => state.setPreviewUrl);

  const [mode, setMode]   = useState<PanelMode>("background");
  const [busy, setBusy]   = useState(false);

  const [bgMode, setBgMode]       = useState<BgMode>("transparent");
  const [bgColor, setBgColor]     = useState("#ffffff");
  const [threshold, setThreshold] = useState(0.5);

  const [selectedFx, setSelectedFx] = useState(EFFECTS[0].key);
  const [fxParams, setFxParams]     = useState<Record<string, number>>(buildDefaults);

  const activeFxDef = EFFECTS.find(e => e.key === selectedFx)!;

  const getParam = (fxKey: string, paramKey: string) =>
    fxParams[`${fxKey}.${paramKey}`] ??
    EFFECTS.find(e => e.key === fxKey)?.params.find(p => p.key === paramKey)?.default ??
    0;

  const setParam = (fxKey: string, paramKey: string, val: number) =>
    setFxParams(prev => ({ ...prev, [`${fxKey}.${paramKey}`]: val }));

  function parseBgColor(): [number, number, number] | undefined {
    if (bgMode !== "color") return undefined;
    return [
      parseInt(bgColor.slice(1, 3), 16),
      parseInt(bgColor.slice(3, 5), 16),
      parseInt(bgColor.slice(5, 7), 16),
    ];
  }

  const handleBgApply = useCallback(async () => {
    setBusy(true);
    const tid = toast.loading(t("bgeffect.previewLoad"));
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
      toast.success(t("bgeffect.previewReady"), { id: tid });
    } catch (e) {
      toast.error(t("common.failed"), { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, image, bgMode, bgColor, threshold, setPreviewUrl]);

  const handleBgExport = useCallback(async () => {
    const ext = bgMode === "transparent" ? "png" : formatExt(image.format);
    const dst = await pickSavePath(image.path, ext, "_nobg");
    if (!dst) return;

    setBusy(true);
    const tid = toast.loading(t("bgeffect.removingBg"));
    try {
      const r = await bgRemoveImage(image.path, dst, {
        threshold,
        bg_mode: bgMode,
        bg_color: parseBgColor(),
      });
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      toast.success(t("bgeffect.bgRemoved"), {
        id: tid,
        description: `${r.info.width} × ${r.info.height}px`,
        action: { label: t("common.show"), onClick: () => revealItemInDir(r.output_path) },
      });
    } catch (e) {
      toast.error(t("common.failed"), { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, image, bgMode, bgColor, threshold, setCurrentImage]);

  const handleEffectApply = useCallback(async () => {
    const params: Record<string, number> = {};
    for (const p of activeFxDef.params) params[p.key] = getParam(selectedFx, p.key);

    setBusy(true);
    const fxLabel = t(activeFxDef.labelKey);
    const tid = toast.loading(t("bgeffect.previewing", fxLabel));
    try {
      const tmp = await tempDir();
      const tmpPath = `${tmp}pixforge_fxpreview.png`;
      await applyEffect(image.path, tmpPath, { effect: selectedFx, params });
      const preview = await generatePreview(tmpPath, 1200);
      setPreviewUrl(preview);
      toast.success(t("bgeffect.previewReady"), { id: tid });
    } catch (e) {
      toast.error(t("common.failed"), { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, image, selectedFx, activeFxDef, fxParams, setPreviewUrl]);

  const handleEffectExport = useCallback(async () => {
    const ext = formatExt(image.format);
    const dst = await pickSavePath(image.path, ext, `_${selectedFx}`);
    if (!dst) return;

    const params: Record<string, number> = {};
    for (const p of activeFxDef.params) params[p.key] = getParam(selectedFx, p.key);

    setBusy(true);
    const fxLabel = t(activeFxDef.labelKey);
    const tid = toast.loading(t("bgeffect.applying", fxLabel));
    try {
      const r = await applyEffect(image.path, dst, { effect: selectedFx, params });
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      toast.success(t("bgeffect.effectApplied"), {
        id: tid,
        description: `${r.info.width} × ${r.info.height}px`,
        action: { label: t("common.show"), onClick: () => revealItemInDir(r.output_path) },
      });
    } catch (e) {
      toast.error(t("common.failed"), { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, image, selectedFx, activeFxDef, fxParams, setCurrentImage]);

  function ActionButtons({ onApply, onExport }: { onApply: () => void; onExport: () => void }) {
    return (
      <div className="flex gap-2">
        <button
          type="button" onClick={onApply} disabled={busy}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-accent text-sm font-medium text-foreground transition-colors hover:bg-accent/80 disabled:opacity-50"
        >
          {busy ? <Loader size={13} className="animate-spin" aria-hidden="true" /> : <Eye size={13} strokeWidth={1.5} aria-hidden="true" />}
          {t("common.apply")}
        </button>
        <button
          type="button" onClick={onExport} disabled={busy}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} strokeWidth={1.5} aria-hidden="true" />}
          {t("common.export")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">{t("bgeffect.title")}</h2>

      {/* Mode tabs */}
      <div className="flex overflow-hidden rounded-lg border border-border" role="tablist">
        {(["background", "effects"] as PanelMode[]).map((m, i) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 py-1.5 text-xs font-medium capitalize transition-colors",
              i === 0 && "border-r border-border",
              mode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m === "background" ? t("bgeffect.background") : t("bgeffect.effects")}
          </button>
        ))}
      </div>

      {/* ─ Background section ───────────────────────────────────────────────── */}
      {mode === "background" && (
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{t("bgeffect.outputMode")}</Label>
            <div className="flex gap-1.5">
              {([
                { id: "transparent" as BgMode, icon: Eraser,      labelKey: "bgeffect.transparent" },
                { id: "color"       as BgMode, icon: PaintBucket, labelKey: "bgeffect.fillColor"    },
              ]).map(({ id, icon: Icon, labelKey }) => (
                <button
                  key={id} type="button" onClick={() => setBgMode(id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs transition-colors hover:bg-accent",
                    bgMode === id && "border-primary bg-accent text-accent-foreground"
                  )}
                >
                  <Icon size={13} strokeWidth={1.5} aria-hidden="true" />
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          {bgMode === "color" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("bgeffect.bgColor")}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor}
                  onChange={e => setBgColor(e.target.value)}
                  aria-label={t("bgeffect.bgColor")}
                  className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <span className="font-mono text-xs text-muted-foreground">{bgColor.toUpperCase()}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">{t("bgeffect.threshold")}</Label>
              <Input
                type="number" min={0.01} max={0.99} step={0.01}
                value={threshold}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) setThreshold(Math.min(0.99, Math.max(0.01, v)));
                }}
                aria-label={t("bgeffect.threshold")}
                className="h-7 w-20 text-xs text-right"
              />
            </div>
            <input
              type="range" min={0.01} max={0.99} step={0.01}
              value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              aria-label={t("bgeffect.threshold")}
              className="h-1.5 w-full cursor-pointer accent-primary"
            />
            <p className="text-[10px] text-muted-foreground">{t("bgeffect.thresholdHint")}</p>
          </div>

          <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground">{t("bgeffect.model")}</p>
          </div>

          <ActionButtons onApply={handleBgApply} onExport={handleBgExport} />
        </div>
      )}

      {/* ─ Effects section ──────────────────────────────────────────────────── */}
      {mode === "effects" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-5 gap-1" role="listbox" aria-label={t("bgeffect.effects")}>
            {EFFECTS.map(fx => {
              const Icon = fx.icon;
              return (
                <button
                  key={fx.key}
                  type="button"
                  role="option"
                  aria-selected={selectedFx === fx.key}
                  onClick={() => setSelectedFx(fx.key)}
                  title={t(fx.labelKey)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground",
                    selectedFx === fx.key && "border-primary bg-accent text-accent-foreground"
                  )}
                >
                  <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                  <span className="text-[9px] leading-none">{t(fx.labelKey)}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-xs font-medium">{t(activeFxDef.labelKey)}</p>
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
