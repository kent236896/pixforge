import { useState, useEffect, useCallback, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  ImagePlus, FolderOpen, Play, Square, X, CheckCircle2,
  AlertCircle, Clock, Loader2, FolderOutput, Trash2,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  runBatch, cancelBatch, expandDropPaths, pickDirectory, pickOpenImages, formatBytes,
  listen, type BatchOperation, type BatchFileResult, type ResizeParams,
} from "@/lib/invoke";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueueItem {
  path: string;
  name: string;
  status: "waiting" | "processing" | "done" | "error";
  error?: string;
  outputPath?: string;
}

const IMAGE_EXTS = new Set([
  "png","jpg","jpeg","webp","avif","gif","tiff","tif","bmp","svg","ico",
]);

function isImagePath(p: string) {
  return IMAGE_EXTS.has(p.split(".").pop()?.toLowerCase() ?? "");
}

function basename(p: string) {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, error }: { status: QueueItem["status"]; error?: string }) {
  if (status === "waiting") {
    return <Clock size={13} className="shrink-0 text-muted-foreground" />;
  }
  if (status === "processing") {
    return <Loader2 size={13} className="shrink-0 animate-spin text-primary" />;
  }
  if (status === "done") {
    return <CheckCircle2 size={13} className="shrink-0 text-emerald-500" />;
  }
  return (
    <span title={error} className="cursor-help">
      <AlertCircle size={13} className="shrink-0 text-destructive" />
    </span>
  );
}

// ── Op settings sub-panels ────────────────────────────────────────────────────

const FORMATS = ["PNG", "JPEG", "WEBP", "GIF", "TIFF", "BMP"];

function RangeRow({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs font-mono">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-primary"
      />
    </div>
  );
}

function ConvertSettings({
  format, quality, onFormat, onQuality,
}: {
  format: string; quality: number;
  onFormat: (f: string) => void; onQuality: (q: number) => void;
}) {
  const lossy = format === "JPEG" || format === "WEBP";
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Target Format</Label>
        <div className="grid grid-cols-3 gap-1">
          {FORMATS.map(f => (
            <button
              key={f}
              type="button"
              onClick={() => onFormat(f)}
              className={cn(
                "rounded border border-border py-1.5 text-[11px] font-medium transition-colors hover:bg-accent",
                format === f && "border-primary bg-accent text-accent-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {lossy && (
        <RangeRow
          label="Quality" value={quality} min={1} max={100} step={1}
          onChange={onQuality}
        />
      )}
    </div>
  );
}

function ResizeSettings({
  mode, percent, longest, onMode, onPercent, onLongest,
}: {
  mode: "percent" | "longest";
  percent: number; longest: number;
  onMode: (m: "percent" | "longest") => void;
  onPercent: (v: number) => void;
  onLongest: (v: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Mode</Label>
        <div className="flex gap-1">
          {(["percent", "longest"] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={cn(
                "flex-1 rounded border border-border py-1.5 text-[11px] font-medium capitalize transition-colors hover:bg-accent",
                mode === m && "border-primary bg-accent text-accent-foreground"
              )}
            >
              {m === "percent" ? "% Scale" : "Longest Side"}
            </button>
          ))}
        </div>
      </div>
      {mode === "percent" ? (
        <RangeRow
          label="Scale" value={percent} min={1} max={200} step={1} unit="%"
          onChange={onPercent}
        />
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Max px</Label>
          <Input
            type="number" min={16} max={8192} step={1}
            value={longest}
            onChange={e => {
              const v = parseInt(e.target.value);
              if (!isNaN(v)) onLongest(Math.min(8192, Math.max(16, v)));
            }}
            className="h-7 w-full text-xs"
          />
        </div>
      )}
    </div>
  );
}

function OptimizeSettings({ quality, onQuality }: { quality: number; onQuality: (q: number) => void }) {
  return (
    <div className="space-y-1.5">
      <RangeRow
        label="Quality" value={quality} min={1} max={100} step={1}
        onChange={onQuality}
      />
      <p className="text-[10px] text-muted-foreground">Applies to JPEG · WebP · AVIF</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BatchPanel() {
  const [queue, setQueue]         = useState<QueueItem[]>([]);
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState({ done: 0, total: 0 });

  // Operation settings
  const [opKind, setOpKind]       = useState<"convert" | "resize" | "optimize">("convert");
  const [convertFmt, setConvertFmt]   = useState("PNG");
  const [convertQuality, setConvertQuality] = useState(90);
  const [resizeMode, setResizeMode]   = useState<"percent" | "longest">("percent");
  const [resizePercent, setResizePercent] = useState(50);
  const [resizeLongest, setResizeLongest] = useState(1920);
  const [optimizeQuality, setOptimizeQuality] = useState(80);

  // Output settings
  const [outDir, setOutDir]         = useState("");
  const [nameTemplate, setNameTemplate] = useState("{name}_out");

  const unlistenRef = useRef<(() => void) | null>(null);

  // ── File queue helpers ──────────────────────────────────────────────────────

  const addFiles = useCallback((paths: string[]) => {
    const imgs = paths.filter(isImagePath);
    if (imgs.length === 0) return;
    setQueue(prev => {
      const existing = new Set(prev.map(i => i.path));
      const fresh = imgs
        .filter(p => !existing.has(p))
        .map(p => ({ path: p, name: basename(p), status: "waiting" as const }));
      return [...prev, ...fresh];
    });
  }, []);

  const removeItem = useCallback((idx: number) => {
    setQueue(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const clearQueue = useCallback(() => setQueue([]), []);

  // ── Drag-drop (Tauri native) — expand folders automatically ────────────────

  useEffect(() => {
    if (running) return;
    const win = getCurrentWebviewWindow();
    let unlisten: (() => void) | null = null;
    win.onDragDropEvent(async ev => {
      if (ev.payload.type === "drop") {
        const raw = (ev.payload as { type: "drop"; paths: string[] }).paths;
        try {
          const expanded = await expandDropPaths(raw);
          addFiles(expanded);
        } catch {
          addFiles(raw); // fallback: treat all as files
        }
      }
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [running, addFiles]);

  // ── Batch start/cancel ─────────────────────────────────────────────────────

  const buildOp = (): BatchOperation => {
    switch (opKind) {
      case "convert":
        return { kind: "convert", convert: { format: convertFmt, quality: convertQuality } };
      case "resize": {
        const resize: ResizeParams =
          resizeMode === "percent"
            ? { mode: "percent", percent: resizePercent, no_upscale: false }
            : { mode: "longest", longest: resizeLongest, no_upscale: true };
        return { kind: "resize", resize };
      }
      case "optimize":
        return { kind: "optimize", quality: optimizeQuality };
    }
  };

  const TEMPLATE_VARS = ["{name}", "{index}", "{ext}"];
  const templateValid = TEMPLATE_VARS.some(v => nameTemplate.includes(v));

  const handleStart = useCallback(async () => {
    if (queue.length === 0) {
      toast.error("Add images to the queue first");
      return;
    }
    if (!outDir) {
      toast.error("Select an output folder");
      return;
    }
    if (!TEMPLATE_VARS.some(v => nameTemplate.includes(v))) {
      toast.error("Name template must contain at least one variable", {
        description: "Use {name}, {index}, or {ext}",
      });
      return;
    }

    // Reset all to waiting
    setQueue(prev => prev.map(item => ({
      ...item, status: "waiting", error: undefined, outputPath: undefined,
    })));
    setProgress({ done: 0, total: queue.length });
    setRunning(true);

    // Subscribe to progress events
    const unlisten = await listen<BatchFileResult>("batch://progress", ev => {
      const r = ev.payload;
      setProgress({ done: r.done, total: r.total });
      setQueue(prev => prev.map((item, i) =>
        i === r.index
          ? {
              ...item,
              status: r.status as QueueItem["status"],
              error: r.error ?? undefined,
              outputPath: r.output_path ?? undefined,
            }
          : item
      ));
    });
    unlistenRef.current = unlisten;

    const srcPaths = queue.map(i => i.path);
    const op = buildOp();
    const tid = toast.loading(`Processing ${srcPaths.length} files…`);

    try {
      await runBatch(srcPaths, op, outDir, nameTemplate);
      setQueue(prev => {
        const done = prev.filter(i => i.status === "done").length;
        const err  = prev.filter(i => i.status === "error").length;
        if (err > 0) {
          toast.warning(`Done: ${done} succeeded, ${err} failed`, { id: tid });
        } else {
          toast.success(`All ${done} files processed`, { id: tid });
        }
        return prev;
      });
    } catch (e) {
      toast.error("Batch failed", { id: tid, description: String(e) });
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setRunning(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, outDir, nameTemplate, opKind, convertFmt, convertQuality, resizeMode, resizePercent, resizeLongest, optimizeQuality]);

  const handleCancel = useCallback(async () => {
    await cancelBatch();
    toast.info("Cancelling…");
  }, []);

  // Cleanup listener on unmount
  useEffect(() => () => { unlistenRef.current?.(); }, []);

  // ── Counts ──────────────────────────────────────────────────────────────────

  const doneCount  = queue.filter(i => i.status === "done").length;
  const errCount   = queue.filter(i => i.status === "error").length;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: file queue ─────────────────────────────────────────────── */}
      <div className="flex flex-[3] flex-col gap-3 overflow-hidden border-r border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Batch Process</h2>
          {queue.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">{queue.length} files</span>
              {!running && (
                <button
                  type="button"
                  onClick={clearQueue}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 size={11} />
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>

        {/* Drop / add zone */}
        {!running && (
          <button
            type="button"
            onClick={async () => {
              const picked = await pickOpenImages();
              if (picked.length > 0) addFiles(picked);
            }}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent/20 hover:text-foreground shrink-0"
          >
            <ImagePlus size={14} />
            Drop images or folders here · click to add files
          </button>
        )}

        {/* File list */}
        {queue.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImagePlus size={32} strokeWidth={1} />
            <p className="text-xs">No images added yet</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto rounded-lg border border-border">
            <AnimatePresence initial={false}>
              {queue.map((item, idx) => (
                <motion.div
                  key={item.path}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    "flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0",
                    item.status === "processing" && "bg-accent/30",
                    item.status === "done" && "bg-emerald-500/5",
                    item.status === "error" && "bg-destructive/5",
                  )}
                >
                  <StatusBadge status={item.status} error={item.error} />
                  <span
                    className="flex-1 truncate text-xs font-mono"
                    title={item.path}
                  >
                    {item.name}
                  </span>
                  {item.status === "done" && item.outputPath && (
                    <button
                      type="button"
                      onClick={() => revealItemInDir(item.outputPath!)}
                      className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      title="Show in Explorer"
                    >
                      <FolderOutput size={12} />
                    </button>
                  )}
                  {item.status === "error" && item.error && (
                    <span className="shrink-0 max-w-[120px] truncate text-[10px] text-destructive" title={item.error}>
                      {item.error}
                    </span>
                  )}
                  {!running && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X size={12} />
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Summary row */}
        {queue.length > 0 && (doneCount > 0 || errCount > 0) && (
          <div className="flex gap-3 text-[11px] shrink-0">
            {doneCount > 0 && (
              <span className="flex items-center gap-1 text-emerald-500">
                <CheckCircle2 size={11} />{doneCount} done
              </span>
            )}
            {errCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertCircle size={11} />{errCount} failed
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Right: settings + progress + actions ─────────────────────────── */}
      <div className="flex flex-[2] flex-col gap-4 overflow-y-auto p-4 min-w-[220px] max-w-[300px]">

        {/* Operation selector */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Operation</h3>
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(["convert", "resize", "optimize"] as const).map((k, i) => (
              <button
                key={k}
                type="button"
                onClick={() => setOpKind(k)}
                disabled={running}
                className={cn(
                  "flex-1 py-1.5 text-[11px] font-medium capitalize transition-colors",
                  i < 2 && "border-r border-border",
                  opKind === k
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                  "disabled:opacity-40"
                )}
              >
                {k}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-border p-3">
            {opKind === "convert" && (
              <ConvertSettings
                format={convertFmt} quality={convertQuality}
                onFormat={setConvertFmt} onQuality={setConvertQuality}
              />
            )}
            {opKind === "resize" && (
              <ResizeSettings
                mode={resizeMode} percent={resizePercent} longest={resizeLongest}
                onMode={setResizeMode} onPercent={setResizePercent} onLongest={setResizeLongest}
              />
            )}
            {opKind === "optimize" && (
              <OptimizeSettings quality={optimizeQuality} onQuality={setOptimizeQuality} />
            )}
          </div>
        </div>

        {/* Output settings */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Output</h3>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Folder</Label>
            <div className="flex gap-1.5">
              <Input
                readOnly
                value={outDir}
                placeholder="Select folder…"
                className="h-7 flex-1 truncate text-xs"
              />
              <button
                type="button"
                disabled={running}
                onClick={async () => {
                  const dir = await pickDirectory();
                  if (dir) setOutDir(dir);
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <FolderOpen size={13} />
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Name Template
            </Label>
            <Input
              value={nameTemplate}
              onChange={e => setNameTemplate(e.target.value)}
              disabled={running}
              placeholder="{name}_out"
              className={cn("h-7 text-xs font-mono", !templateValid && nameTemplate.length > 0 && "border-destructive focus-visible:ring-destructive")}
            />
            {!templateValid && nameTemplate.length > 0 ? (
              <p className="text-[10px] text-destructive">
                Must include at least one variable: {"{name}"}, {"{index}"}, or {"{ext}"}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Variables: <code className="font-mono">{"{name}"}</code> <code className="font-mono">{"{index}"}</code> <code className="font-mono">{"{ext}"}</code>
              </p>
            )}
          </div>
        </div>

        {/* Progress */}
        {running && (
          <div className="space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-mono">{progress.done}/{progress.total}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="text-right text-[10px] text-muted-foreground">{pct}%</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleStart}
            disabled={running || queue.length === 0 || !outDir || !templateValid}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            <Play size={13} strokeWidth={2} />
            Start {queue.length > 0 && `(${queue.length})`}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={!running}
            className="flex h-9 w-20 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-30"
          >
            <Square size={13} strokeWidth={2} />
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
