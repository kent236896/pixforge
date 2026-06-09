import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { tempDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  optimizeImage, generatePreview, pickSavePath, formatBytes, formatExt, type ImageInfo,
} from "@/lib/invoke";
import { useExportShortcut } from "@/lib/useExportShortcut";
import { useAppStore } from "@/store/app";
import { useT } from "@/lib/i18n";
import { ArrowRight, Download, Eye, Loader, TrendingDown } from "lucide-react";

const QUALITY_FORMATS = new Set(["JPEG", "WEBP"]);

interface Props { image: ImageInfo }

interface PreviewStats {
  fileSize: number;
  savedBytes: number;
  savedPercent: number;
}

function sliderValue(value: number | readonly number[], fallback: number) {
  return Array.isArray(value) ? value[0] ?? fallback : value;
}

export function OptimizePanel({ image }: Props) {
  const t = useT();
  const setCurrentImage = useAppStore(state => state.setCurrentImage);
  const setPreviewUrl   = useAppStore(state => state.setPreviewUrl);

  const [quality, setQuality]         = useState(80);
  const [busy, setBusy]               = useState(false);
  const [previewStats, setPreviewStats] = useState<PreviewStats | null>(null);

  const supportsQuality = QUALITY_FORMATS.has(image.format.toUpperCase());

  useEffect(() => { setPreviewStats(null); }, [quality, image.path]);

  const handleApply = useCallback(async () => {
    setBusy(true);
    const tid = toast.loading(t("optimize.previewLoad"));
    try {
      const tmp = await tempDir();
      const ext = formatExt(image.format);
      const tmpPath = `${tmp}pixforge_opt_preview.${ext}`;
      const r = await optimizeImage(image.path, tmpPath, quality);
      const preview = await generatePreview(tmpPath, 1200);
      setPreviewUrl(preview);
      setPreviewStats({
        fileSize: r.info.file_size,
        savedBytes: r.saved_bytes,
        savedPercent: r.saved_percent,
      });
      toast.success(t("optimize.previewReady"), { id: tid });
    } catch (e) {
      toast.error(t("common.failed"), { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  }, [t, image, quality, setPreviewUrl]);

  const handleExport = useCallback(async () => {
    const ext = formatExt(image.format);
    const dst = await pickSavePath(image.path, ext, "_optimized");
    if (!dst) return;

    setBusy(true);
    const tid = toast.loading(t("optimize.loading"));
    try {
      const r = await optimizeImage(image.path, dst, quality);
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      const saved = r.saved_bytes > 0
        ? t("optimize.saved", formatBytes(r.saved_bytes), r.saved_percent.toFixed(1))
        : `${formatBytes(r.original_size)} → ${formatBytes(r.info.file_size)}`;
      toast.success(t("optimize.success"), {
        id: tid,
        description: saved,
        action: { label: t("common.show"), onClick: () => revealItemInDir(r.output_path) },
        icon: <TrendingDown size={14} />,
      });
    } catch (e) {
      toast.error(t("optimize.error"), { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  }, [t, quality, image, setCurrentImage]);

  useExportShortcut(handleExport);

  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <h2 className="text-sm font-semibold">{t("optimize.title")}</h2>

      <div className="space-y-0.5 rounded-lg bg-muted p-3">
        <p className="text-[11px] text-muted-foreground">{t("optimize.original")}</p>
        <p className="text-sm font-mono font-medium">{formatBytes(image.file_size)}</p>
        <p className="text-[11px] text-muted-foreground">
          {image.format} · {image.width} × {image.height}px
        </p>
      </div>

      {supportsQuality ? (
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs text-muted-foreground">{t("optimize.quality")}</Label>
            <span className="text-xs font-mono">{quality}</span>
          </div>
          <Slider
            value={[quality]}
            onValueChange={value => setQuality(sliderValue(value, quality))}
            min={1} max={100} step={1}
            aria-label={t("optimize.quality")}
          />
          <p className="text-[11px] text-muted-foreground">{t("optimize.lowerHint")}</p>
        </div>
      ) : (
        <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
          {image.format === "PNG" ? t("optimize.pngHint") : t("optimize.otherHint")}
        </p>
      )}

      {previewStats ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">{t("optimize.previewResult")}</p>
          <div className="flex items-center gap-2 text-sm font-mono">
            <span className="text-muted-foreground">{formatBytes(image.file_size)}</span>
            <ArrowRight size={13} className="shrink-0 text-muted-foreground/50" />
            <span className="font-semibold">{formatBytes(previewStats.fileSize)}</span>
            {previewStats.savedBytes > 0 && (
              <span className="ml-auto text-xs font-sans text-emerald-500 dark:text-emerald-400">
                −{previewStats.savedPercent.toFixed(1)}%
              </span>
            )}
          </div>
          {previewStats.savedBytes <= 0 && (
            <p className="text-[10px] text-muted-foreground">{t("optimize.noReduction")}</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="text-[11px] text-muted-foreground text-center">{t("optimize.applyHint")}</p>
        </div>
      )}

      <div className="mt-auto space-y-2">
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={busy}
            aria-label={t("optimize.apply")}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-accent text-sm font-medium text-foreground transition-colors hover:bg-accent/80 disabled:opacity-50"
          >
            {busy ? <Loader size={13} className="animate-spin" aria-hidden="true" /> : <Eye size={13} strokeWidth={1.5} aria-hidden="true" />}
            {t("optimize.apply")}
          </button>
          <button
            onClick={handleExport}
            disabled={busy}
            aria-label={t("optimize.export")}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} strokeWidth={1.5} aria-hidden="true" />}
            {t("optimize.export")}
          </button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground">{t("optimize.exportHint")}</p>
      </div>
    </div>
  );
}
