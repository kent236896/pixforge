import { useCallback, useState } from "react";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { optimizeImage, generatePreview, pickSavePath, formatBytes, formatExt, type ImageInfo } from "@/lib/invoke";
import { useExportShortcut } from "@/lib/useExportShortcut";
import { useAppStore } from "@/store/app";
import { Loader, TrendingDown } from "lucide-react";

const QUALITY_FORMATS = new Set(["JPEG", "WEBP"]);

interface Props { image: ImageInfo }

function sliderValue(value: number | readonly number[], fallback: number) {
  return Array.isArray(value) ? value[0] ?? fallback : value;
}

export function OptimizePanel({ image }: Props) {
  const setCurrentImage = useAppStore(state => state.setCurrentImage);
  const [quality, setQuality] = useState(80);
  const [loading, setLoading] = useState(false);

  const supportsQuality = QUALITY_FORMATS.has(image.format.toUpperCase());

  const handleExport = useCallback(async () => {
    const ext = formatExt(image.format);
    const dst = await pickSavePath(image.path, ext, "_optimized");
    if (!dst) return;

    setLoading(true);
    const tid = toast.loading("Optimizing...");
    try {
      const r = await optimizeImage(image.path, dst, quality);
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      const saved = r.saved_bytes > 0
        ? `Saved ${formatBytes(r.saved_bytes)} (${r.saved_percent.toFixed(1)}%)`
        : `${formatBytes(r.original_size)} -> ${formatBytes(r.info.file_size)}`;
      toast.success("Optimized", {
        id: tid,
        description: saved,
        action: { label: "Show", onClick: () => revealItemInDir(r.output_path) },
        icon: <TrendingDown size={14} />,
      });
    } catch (e) {
      toast.error("Optimization failed", { id: tid, description: String(e) });
    } finally {
      setLoading(false);
    }
  }, [quality, image, setCurrentImage]);

  useExportShortcut(handleExport);

  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <h2 className="text-sm font-semibold">Compress & Optimize</h2>

      <div className="space-y-0.5 rounded-lg bg-muted p-3">
        <p className="text-[11px] text-muted-foreground">Original</p>
        <p className="text-sm font-mono font-medium">{formatBytes(image.file_size)}</p>
        <p className="text-[11px] text-muted-foreground">{image.format} - {image.width} x {image.height}px</p>
      </div>

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
            ? "PNG is lossless; it will be re-encoded with optimized compression."
            : "Will re-encode using best settings for this format."}
        </p>
      )}

      <div className="mt-auto">
        <button
          onClick={handleExport}
          disabled={loading}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading && <Loader size={14} className="animate-spin" />}
          Optimize & Export
        </button>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Ctrl+S</p>
      </div>
    </div>
  );
}
