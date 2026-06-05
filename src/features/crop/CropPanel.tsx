import { useCallback, useState } from "react";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cropRotateImage, generatePreview, pickSavePath, formatExt, type ImageInfo } from "@/lib/invoke";
import { useAppStore, type CropTransform } from "@/store/app";
import { Loader, RotateCw, FlipHorizontal, FlipVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props { image: ImageInfo }

type Op = "rotate90" | "rotate180" | "rotate270" | "fliph" | "flipv" | "crop" | "rotate";

export function CropPanel({ image }: Props) {
  const cropRegion = useAppStore(state => state.cropRegion);
  const cropTransform = useAppStore(state => state.cropTransform);
  const cropAngle = useAppStore(state => state.cropAngle);
  const setCropRegion = useAppStore(state => state.setCropRegion);
  const setCropTransform = useAppStore(state => state.setCropTransform);
  const setCropAngle = useAppStore(state => state.setCropAngle);
  const setCurrentImage = useAppStore(state => state.setCurrentImage);
  const [loading, setLoading] = useState<Op | null>(null);
  const region = cropRegion ?? { x: 0, y: 0, w: image.width, h: image.height };

  const updateField = useCallback((field: "x" | "y" | "w" | "h", value: number) => {
    const next = { ...region, [field]: Number.isFinite(value) ? Math.round(value) : 0 };
    next.x = Math.min(Math.max(0, next.x), image.width - 1);
    next.y = Math.min(Math.max(0, next.y), image.height - 1);
    next.w = Math.min(Math.max(1, next.w), image.width - next.x);
    next.h = Math.min(Math.max(1, next.h), image.height - next.y);
    setCropRegion(next);
  }, [image.height, image.width, region, setCropRegion]);

  const run = useCallback(async (op: Op, extra?: object) => {
    const ext = formatExt(image.format);
    const dst = await pickSavePath(image.path, ext, `_${op}`);
    if (!dst) return;

    setLoading(op);
    const tid = toast.loading(`Applying ${op}...`);
    try {
      const r = await cropRotateImage(image.path, dst, { operation: op, ...extra } as any);
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      toast.success("Done", {
        id: tid,
        description: `${r.info.width} x ${r.info.height}px`,
        action: { label: "Show", onClick: () => revealItemInDir(r.output_path) },
      });
    } catch (e) {
      toast.error("Operation failed", { id: tid, description: String(e) });
    } finally {
      setLoading(null);
    }
  }, [image, setCurrentImage]);

  const setAngle = useCallback((angle: number) => {
    const next = Math.min(Math.max(Math.round(angle), 0), 360);
    setCropAngle(next);
    if (next !== 0) setCropTransform(null);
  }, [setCropAngle, setCropTransform]);

  // cropTransform takes priority; arbitrary angle is fallback; crop is default
  const exportOp: Op = cropTransform ?? (cropAngle > 0 ? "rotate" : "crop");
  const exportExtra = cropTransform
    ? undefined
    : cropAngle > 0
      ? { angle: cropAngle }
      : { x: region.x, y: region.y, w: region.w, h: region.h };

  const QuickBtn = ({ op, icon: Icon, label }: { op: Exclude<Op, "crop">; icon: React.ElementType; label: string }) => (
    <button
      type="button"
      onClick={() => {
        setCropAngle(0);
        setCropTransform(cropTransform === op ? null : op as CropTransform);
      }}
      disabled={loading !== null}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-foreground disabled:opacity-40",
        cropTransform === op && "border-primary bg-accent text-accent-foreground"
      )}
    >
      <Icon size={16} strokeWidth={1.5} />
      <span className="text-[10px]">{label}</span>
    </button>
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">Crop & Rotate</h2>

      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">Crop Region (px)</Label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { l: "X", field: "x" as const, v: region.x, max: image.width - 1 },
            { l: "Y", field: "y" as const, v: region.y, max: image.height - 1 },
            { l: "Width", field: "w" as const, v: region.w, max: image.width },
            { l: "Height", field: "h" as const, v: region.h, max: image.height },
          ].map(({ l, field, v, max }) => (
            <div key={l} className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{l}</Label>
              <Input
                type="number"
                min={field === "w" || field === "h" ? 1 : 0}
                max={max}
                value={v}
                onChange={e => updateField(field, Number(e.target.value))}
                className="h-8 text-sm"
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Source: {image.width} x {image.height} px</p>

      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground">Center Rotate</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={360}
              value={cropAngle}
              onChange={e => setAngle(Number(e.target.value))}
              className="h-7 w-20 text-sm"
            />
            <span className="text-xs text-muted-foreground">deg</span>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={cropAngle}
          onChange={e => setAngle(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-primary"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Quick Transform</Label>
        <div className="flex gap-1.5">
          <QuickBtn op="rotate90" icon={RotateCw} label="90deg" />
          <QuickBtn op="rotate180" icon={RotateCw} label="180deg" />
          <QuickBtn op="rotate270" icon={RotateCw} label="270deg" />
          <QuickBtn op="fliph" icon={FlipHorizontal} label="Flip H" />
          <QuickBtn op="flipv" icon={FlipVertical} label="Flip V" />
        </div>
      </div>

      <button
        onClick={() => run(exportOp, exportExtra)}
        disabled={loading !== null}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {loading === exportOp && <Loader size={14} className="animate-spin" />}
        Export
      </button>
    </div>
  );
}
