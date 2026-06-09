import { useCallback, useState } from "react";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Link2, Link2Off, Loader, RotateCcw } from "lucide-react";
import { resizeImage, generatePreview, pickSavePath, formatExt, type ImageInfo } from "@/lib/invoke";
import { useExportShortcut } from "@/lib/useExportShortcut";
import { useAppStore, type ResizeSettings } from "@/store/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props { image: ImageInfo }

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(Number.isFinite(v) ? v : min), min), max);
}

export function ResizePanel({ image }: Props) {
  const t = useT();
  const resizeSettings    = useAppStore(state => state.resizeSettings);
  const setCurrentImage   = useAppStore(state => state.setCurrentImage);
  const setResizeSettings = useAppStore(state => state.setResizeSettings);
  const [loading, setLoading] = useState(false);

  const settings: ResizeSettings = resizeSettings ?? {
    width: image.width, height: image.height, noUpscale: true, lockAspect: true,
  };

  const aspect = image.width / image.height;
  const maxW = settings.noUpscale ? image.width  : image.width  * 4;
  const maxH = settings.noUpscale ? image.height : image.height * 4;

  const update = useCallback((patch: Partial<ResizeSettings>) => {
    setResizeSettings({ ...settings, ...patch });
  }, [settings, setResizeSettings]);

  const handleWidthChange = useCallback((w: number) => {
    if (settings.lockAspect) update({ width: w, height: Math.max(1, Math.round(w / aspect)) });
    else update({ width: w });
  }, [settings.lockAspect, aspect, update]);

  const handleHeightChange = useCallback((h: number) => {
    if (settings.lockAspect) update({ width: Math.max(1, Math.round(h * aspect)), height: h });
    else update({ height: h });
  }, [settings.lockAspect, aspect, update]);

  const handleExport = useCallback(async () => {
    const ext = formatExt(image.format);
    const dst = await pickSavePath(image.path, ext, "_resized");
    if (!dst) return;

    setLoading(true);
    const tid = toast.loading(t("resize.loading"));
    try {
      const r = await resizeImage(image.path, dst, {
        mode: "exact",
        width: settings.width,
        height: settings.height,
        no_upscale: settings.noUpscale,
      });
      const preview = await generatePreview(r.output_path, 1200);
      setCurrentImage(r.info, preview);
      toast.success(t("resize.success", r.info.width, r.info.height), {
        id: tid,
        action: { label: t("common.show"), onClick: () => revealItemInDir(r.output_path) },
      });
    } catch (e) {
      toast.error(t("resize.error"), { id: tid, description: String(e) });
    } finally {
      setLoading(false);
    }
  }, [t, image, settings, setCurrentImage]);

  useExportShortcut(handleExport);

  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <h2 className="text-sm font-semibold">{t("resize.title")}</h2>

      {/* W / lock / H */}
      <div className="flex items-end gap-1.5">
        <div className="flex-1 space-y-1">
          <Label className="text-[11px] text-muted-foreground">{t("resize.w")}</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number" min={1} max={maxW}
              value={clamp(settings.width, 1, maxW)}
              onChange={e => handleWidthChange(clamp(Number(e.target.value), 1, maxW))}
              className="h-8 text-sm tabular-nums"
              aria-label={t("resize.w")}
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">px</span>
          </div>
        </div>

        <button
          type="button"
          title={settings.lockAspect ? t("resize.unlockAspect") : t("resize.lockAspect")}
          aria-label={settings.lockAspect ? t("resize.unlockAspect") : t("resize.lockAspect")}
          onClick={() => update({ lockAspect: !settings.lockAspect })}
          className={cn(
            "mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
            settings.lockAspect
              ? "border-primary/50 text-primary hover:border-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
          )}
        >
          {settings.lockAspect ? <Link2 size={13} /> : <Link2Off size={13} />}
        </button>

        <div className="flex-1 space-y-1">
          <Label className="text-[11px] text-muted-foreground">{t("resize.h")}</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number" min={1} max={maxH}
              value={clamp(settings.height, 1, maxH)}
              onChange={e => handleHeightChange(clamp(Number(e.target.value), 1, maxH))}
              className="h-8 text-sm tabular-nums"
              aria-label={t("resize.h")}
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">px</span>
          </div>
        </div>
      </div>

      {/* Options */}
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={settings.noUpscale}
          onChange={e => update({ noUpscale: e.target.checked })}
          className="rounded"
        />
        <span className="text-xs text-muted-foreground">{t("resize.noUpscale")}</span>
      </label>

      {/* Original info + reset */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {t("resize.original", image.width, image.height)}
        </p>
        <button
          type="button"
          aria-label={t("resize.reset")}
          onClick={() => update({ width: image.width, height: image.height })}
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw size={11} aria-hidden="true" />
          {t("resize.reset")}
        </button>
      </div>

      <div className="mt-auto space-y-1.5">
        <button
          onClick={handleExport}
          disabled={loading}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading && <Loader size={14} className="animate-spin" aria-hidden="true" />}
          {t("resize.exportBtn")}
        </button>
        <p className="text-center text-[10px] text-muted-foreground">{t("common.ctrl_s")}</p>
      </div>
    </div>
  );
}
