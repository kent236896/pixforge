import { useCallback, useState } from "react";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { convertImage, generatePreview, pickSavePath, formatBytes, formatExt, type ImageInfo } from "@/lib/invoke";
import { useExportShortcut } from "@/lib/useExportShortcut";
import { useAppStore } from "@/store/app";
import { Loader } from "lucide-react";

const FORMATS = ["PNG", "JPEG", "WEBP", "GIF", "TIFF", "BMP"];
const LOSSY = new Set(["JPEG", "WEBP"]);

interface Props { image: ImageInfo }

function sliderValue(value: number | readonly number[], fallback: number) {
  return Array.isArray(value) ? value[0] ?? fallback : value;
}

export function ConvertPanel({ image }: Props) {
  const setCurrentImage = useAppStore(state => state.setCurrentImage);
  const [format, setFormat] = useState("PNG");
  const [quality, setQuality] = useState(85);
  const [loading, setLoading] = useState(false);

  const handleExport = useCallback(async () => {
    const ext = formatExt(format);
    const dst = await pickSavePath(image.path, ext, "_converted");
    if (!dst) return;

    setLoading(true);
    const tid = toast.loading(`Converting to ${format}...`);
    try {
      const r = await convertImage(image.path, dst, {
        format,
        quality,
        bg_color: format === "JPEG" ? [255, 255, 255] : undefined,
      });
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      toast.success(`Saved as ${format}`, {
        id: tid,
        description: `${formatBytes(r.original_size)} -> ${formatBytes(r.info.file_size)}`,
        action: { label: "Show", onClick: () => revealItemInDir(r.output_path) },
      });
    } catch (e) {
      toast.error("Conversion failed", { id: tid, description: String(e) });
    } finally {
      setLoading(false);
    }
  }, [format, quality, image, setCurrentImage]);

  useExportShortcut(handleExport);

  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <h2 className="text-sm font-semibold">Format Conversion</h2>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Output Format</Label>
        <Select value={format} onValueChange={value => value && setFormat(value)}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FORMATS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {LOSSY.has(format) && (
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
        </div>
      )}

      {format === "JPEG" && (
        <p className="text-[11px] text-muted-foreground">
          Transparent areas {"->"} white background
        </p>
      )}

      <div className="mt-auto">
        <button
          onClick={handleExport}
          disabled={loading}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading && <Loader size={14} className="animate-spin" />}
          Export as {format}
        </button>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Ctrl+S</p>
      </div>
    </div>
  );
}
