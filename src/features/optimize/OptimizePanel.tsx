import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { tempDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  optimizeImage,
  generatePreview,
  pickSavePath,
  formatBytes,
  formatExt,
  type ImageInfo,
} from "@/lib/invoke";
import { useExportShortcut } from "@/lib/useExportShortcut";
import { useAppStore } from "@/store/app";
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
  const setCurrentImage = useAppStore(state => state.setCurrentImage);
  const setPreviewUrl   = useAppStore(state => state.setPreviewUrl);

  const [quality, setQuality]         = useState(80);
  const [busy, setBusy]               = useState(false);
  const [previewStats, setPreviewStats] = useState<PreviewStats | null>(null);

  const supportsQuality = QUALITY_FORMATS.has(image.format.toUpperCase());

  // Stale preview when quality or source image changes
  useEffect(() => { setPreviewStats(null); }, [quality, image.path]);

  // ── Apply: process to temp, show size diff in panel ───────────────────────
  const handleApply = useCallback(async () => {
    setBusy(true);
    const tid = toast.loading("Generating preview…");
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
      toast.success("Preview ready", { id: tid });
    } catch (e) {
      toast.error("Failed", { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  }, [image, quality, setPreviewUrl]);

  // ── Export: save to chosen path ───────────────────────────────────────────
  const handleExport = useCallback(async () => {
    const ext = formatExt(image.format);
    const dst = await pickSavePath(image.path, ext, "_optimized");
    if (!dst) return;

    setBusy(true);
    const tid = toast.loading("Optimizing…");
    try {
      const r = await optimizeImage(image.path, dst, quality);
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      const saved = r.saved_bytes > 0
        ? `Saved ${formatBytes(r.saved_bytes)} (${r.saved_percent.toFixed(1)}%)`
        : `${formatBytes(r.original_size)} → ${formatBytes(r.info.file_size)}`;
      toast.success("Optimized", {
        id: tid,
        description: saved,
        action: { label: "Show", onClick: () => revealItemInDir(r.output_path) },
        icon: <TrendingDown size={14} />,
      });
    } catch (e) {
      toast.error("Optimization failed", { id: tid, description: String(e) });
    } finally {
      setBusy(false);
    }
  }, [quality, image, setCurrentImage]);

  useExportShortcut(handleExport);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <h2 className="text-sm font-semibold">Compress & Optimize</h2>

      {/* Original info */}
      <div className="space-y-0.5 rounded-lg bg-muted p-3">
        <p className="text-[11px] text-muted-foreground">Original</p>
        <p className="text-sm font-mono font-medium">{formatBytes(image.file_size)}</p>
        <p className="text-[11px] text-muted-foreground">
          {image.format} · {image.width} × {image.height}px
        </p>
      </div>

      {/* Quality slider */}
      {supportsQuality ? (
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs text-muted-foreground">Quality</Label>
            <span className="text-xs font-mono">{quality}</span>
          </div>
          <Slider
            value={[quality]}
            onValueChange={value => setQuality(sliderValue(value, quality))}
            min={1}
            max={100}
            step={1}
          />
          <p className="text-[11px] text-muted-foreground">Lower = smaller file size</p>
        </div>
      ) : (
        <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
          {image.format === "PNG"
            ? "PNG is lossless; will be re-encoded with optimized compression."
            : "Will re-encode using best settings for this format."}
        </p>
      )}

      {/* Preview stats */}
      {previewStats ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">Preview result</p>
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
            <p className="text-[10px] text-muted-foreground">
              No size reduction at this quality level.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="text-[11px] text-muted-foreground text-center">
            Click Apply to preview compression result
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-auto space-y-2">
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={busy}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-accent text-sm font-medium text-foreground transition-colors hover:bg-accent/80 disabled:opacity-50"
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Eye size={13} strokeWidth={1.5} />}
            Apply
          </button>
          <button
            onClick={handleExport}
            disabled={busy}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Download size={13} strokeWidth={1.5} />}
            Export
          </button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground">Ctrl+S to export</p>
      </div>
    </div>
  );
}
