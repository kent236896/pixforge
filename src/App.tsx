import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AnimatePresence, motion } from "framer-motion";
import { Toaster } from "@/components/ui/sonner";
import { Titlebar } from "@/components/layout/Titlebar";
import { Sidebar } from "@/components/layout/Sidebar";
import { Statusbar } from "@/components/layout/Statusbar";
import { useAppStore } from "@/store/app";
import { getImageInfo, generatePreview, formatBytes, pickOpenImage, type ImageInfo } from "@/lib/invoke";
import { ConvertPanel } from "@/features/convert/ConvertPanel";
import { ResizePanel } from "@/features/resize/ResizePanel";
import { CropPanel } from "@/features/crop/CropPanel";
import { OptimizePanel } from "@/features/optimize/OptimizePanel";
import { RotateCw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CropRegion, CropTransform, ResizeSettings } from "@/store/app";

const IMAGE_EXTS = new Set([
  "png","jpg","jpeg","webp","avif","gif","tiff","tif","bmp","heic","heif","svg","ico",
]);

function isImagePath(p: string) {
  return IMAGE_EXTS.has(p.split(".").pop()?.toLowerCase() ?? "");
}

async function loadImage(path: string) {
  if (!path) return;
  try {
    const [info, preview] = await Promise.all([
      getImageInfo(path),
      generatePreview(path, 1200),
    ]);
    useAppStore.getState().setCurrentImage(info, preview);
  } catch (err) {
    console.error("load image:", err);
  }
}

function DropZone({ dragging }: { dragging: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div
        className={cn(
          "flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-16 py-14 text-center transition-all duration-200 cursor-pointer w-full max-w-lg",
          dragging
            ? "border-primary bg-accent/40 scale-[1.02]"
            : "border-border hover:border-primary/50 hover:bg-accent/20"
        )}
        onClick={async () => {
          const path = await pickOpenImage();
          if (path) loadImage(path);
        }}
      >
        <motion.div
          animate={{ scale: dragging ? 1.15 : 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-muted"
        >
          <Upload size={24} className={cn("transition-colors", dragging ? "text-primary" : "text-muted-foreground")} />
        </motion.div>
        <div>
          <p className="text-sm font-medium text-foreground">
            {dragging ? "Release to open" : "Drop images here"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {dragging ? "" : "or click to select  ·  Ctrl+O"}
          </p>
        </div>
        {!dragging && (
          <p className="text-[11px] text-muted-foreground/60">
            PNG · JPG · WEBP · GIF · TIFF · BMP · SVG
          </p>
        )}
      </div>
    </div>
  );
}

function ActivePanel() {
  const activeModule = useAppStore(state => state.activeModule);
  const currentImage = useAppStore(state => state.currentImage);
  if (!currentImage) return null;
  return (
    <AnimatePresence mode="wait">
      <motion.div key={activeModule} className="flex flex-col flex-1"
        initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
        transition={{ duration: 0.15 }}>
        {activeModule === "convert"  && <ConvertPanel  image={currentImage} />}
        {activeModule === "resize"   && <ResizePanel   image={currentImage} />}
        {activeModule === "crop"     && <CropPanel     image={currentImage} />}
        {activeModule === "optimize" && <OptimizePanel image={currentImage} />}
        {activeModule === "batch"    && (
          <div className="flex flex-1 items-center justify-center p-4">
            <p className="text-sm text-muted-foreground">Batch — coming in Stage 4</p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function clampCrop(region: CropRegion, width: number, height: number): CropRegion {
  const x = Math.min(Math.max(0, Math.round(region.x)), width - 1);
  const y = Math.min(Math.max(0, Math.round(region.y)), height - 1);
  const w = Math.min(Math.max(1, Math.round(region.w)), width - x);
  const h = Math.min(Math.max(1, Math.round(region.h)), height - y);
  return { x, y, w, h };
}

type RHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

function ResizePreview({
  image,
  previewUrl,
  settings,
  onUpdate,
}: {
  image: ImageInfo;
  previewUrl: string;
  settings: ResizeSettings;
  onUpdate: (patch: Partial<ResizeSettings>) => void;
}) {
  // Fill the checkerboard container entirely (absolute inset-0 in parent)
  const containerRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  const [ch, setCh] = useState(0);
  const dragRef = useRef<{
    handle: RHandle;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    fixedScale: number; // px-per-image-px, constant for this drag
    aspect: number;
    noUpscale: boolean;
    lockAspect: boolean;
    maxW: number;
    maxH: number;
  } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => { setCw(el.clientWidth); setCh(el.clientHeight); };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scale based on original image to fit container with padding
  const PAD = 40;
  const fixedScale = cw > 0
    ? Math.min((cw - PAD * 2) / image.width, (ch - PAD * 2) / image.height)
    : 0;

  // Display dimensions for the current target (image renders AT these pixel dimensions)
  const dispW = settings.width * fixedScale;
  const dispH = settings.height * fixedScale;
  const imgX = (cw - dispW) / 2;
  const imgY = (ch - dispH) / 2;

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, handle: RHandle) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startW: settings.width,
      startH: settings.height,
      fixedScale,
      aspect: image.width / image.height,
      noUpscale: settings.noUpscale,
      lockAspect: settings.lockAspect,
      maxW: image.width,
      maxH: image.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.fixedScale === 0) return;

    // ×2: frame is centered so both sides move — handle tracks mouse 1:1
    const rawDx = (e.clientX - d.startX) / d.fixedScale;
    const rawDy = (e.clientY - d.startY) / d.fixedScale;
    const h = d.handle;

    let newW = d.startW;
    let newH = d.startH;

    if (h.includes("e")) newW = d.startW + 2 * rawDx;
    if (h.includes("w")) newW = d.startW - 2 * rawDx;
    if (h.includes("s")) newH = d.startH + 2 * rawDy;
    if (h.includes("n")) newH = d.startH - 2 * rawDy;

    if (d.lockAspect) {
      // Lock: adjust the other dimension proportionally
      if (h === "n" || h === "s") {
        newW = newH * d.aspect;
      } else if (h === "e" || h === "w") {
        newH = newW / d.aspect;
      } else {
        // Corner: scale uniformly by the larger ratio
        const ratio = Math.max(newW / d.startW, newH / d.startH);
        newW = d.startW * ratio;
        newH = d.startH * ratio;
      }
    }
    // Unlock: each side changes independently — image will stretch visually

    newW = Math.max(1, Math.round(newW));
    newH = Math.max(1, Math.round(newH));

    if (d.noUpscale) {
      newW = Math.min(newW, d.maxW);
      newH = Math.min(newH, d.maxH);
    }

    onUpdate({ width: newW, height: newH });
  };

  const endDrag = () => { dragRef.current = null; };

  const HANDLES: Array<{ id: RHandle; x: number; y: number; cursor: string }> = [
    { id: "nw", x: imgX,             y: imgY,             cursor: "nwse-resize" },
    { id: "n",  x: imgX + dispW / 2, y: imgY,             cursor: "ns-resize"   },
    { id: "ne", x: imgX + dispW,     y: imgY,             cursor: "nesw-resize" },
    { id: "e",  x: imgX + dispW,     y: imgY + dispH / 2, cursor: "ew-resize"   },
    { id: "se", x: imgX + dispW,     y: imgY + dispH,     cursor: "nwse-resize" },
    { id: "s",  x: imgX + dispW / 2, y: imgY + dispH,     cursor: "ns-resize"   },
    { id: "sw", x: imgX,             y: imgY + dispH,     cursor: "nesw-resize" },
    { id: "w",  x: imgX,             y: imgY + dispH / 2, cursor: "ew-resize"   },
  ];

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-10 select-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {fixedScale > 0 && (
        <>
          {/* Image rendered at target dimensions — objectFit:fill makes it stretch when unlocked */}
          <img
            src={previewUrl}
            alt="preview"
            draggable={false}
            className="pointer-events-none absolute select-none rounded-lg shadow-md"
            style={{ left: imgX, top: imgY, width: dispW, height: dispH, objectFit: "fill" }}
          />
          {/* Frame border */}
          <div
            className="pointer-events-none absolute rounded-[3px] border-2 border-primary/70"
            style={{ left: imgX, top: imgY, width: dispW, height: dispH }}
          />
          {/* 8 handles */}
          {HANDLES.map(h => (
            <div
              key={h.id}
              className="absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-primary bg-background shadow-sm hover:bg-primary/20 active:bg-primary/30"
              style={{ left: h.x, top: h.y, cursor: h.cursor }}
              onPointerDown={e => startDrag(e, h.id)}
            />
          ))}
          {/* Dimension badge below image */}
          <div
            className="pointer-events-none absolute rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-mono text-foreground shadow-sm"
            style={{ left: imgX, top: imgY + dispH + 8 }}
          >
            {settings.width} × {settings.height}
          </div>
        </>
      )}
    </div>
  );
}

function cropTransformStyle(transform: CropTransform) {
  switch (transform) {
    case "rotate90":
      return "rotate(90deg)";
    case "rotate180":
      return "rotate(180deg)";
    case "rotate270":
      return "rotate(270deg)";
    case "fliph":
      return "scaleX(-1)";
    case "flipv":
      return "scaleY(-1)";
    default:
      return "none";
  }
}

function rotatedBounds(width: number, height: number, angle: number) {
  const radians = (angle % 180) * Math.PI / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

function CropOverlay({
  image,
  region,
  onChange,
}: {
  image: { width: number; height: number };
  region: CropRegion;
  onChange: (region: CropRegion) => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    region: CropRegion;
  } | null>(null);

  const left = (region.x / image.width) * 100;
  const top = (region.y / image.height) * 100;
  const width = (region.w / image.width) * 100;
  const height = (region.h / image.height) * 100;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, handle: CropHandle) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { handle, startX: event.clientX, startY: event.clientY, region };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;

    const dx = ((event.clientX - drag.startX) / rect.width) * image.width;
    const dy = ((event.clientY - drag.startY) / rect.height) * image.height;
    const minSize = Math.min(24, Math.max(1, Math.floor(Math.min(image.width, image.height) / 20)));
    let x1 = drag.region.x;
    let y1 = drag.region.y;
    let x2 = drag.region.x + drag.region.w;
    let y2 = drag.region.y + drag.region.h;

    if (drag.handle === "move") {
      const nextX = Math.min(Math.max(0, drag.region.x + dx), image.width - drag.region.w);
      const nextY = Math.min(Math.max(0, drag.region.y + dy), image.height - drag.region.h);
      onChange(clampCrop({ ...drag.region, x: nextX, y: nextY }, image.width, image.height));
      return;
    }

    if (drag.handle.includes("w")) x1 += dx;
    if (drag.handle.includes("e")) x2 += dx;
    if (drag.handle.includes("n")) y1 += dy;
    if (drag.handle.includes("s")) y2 += dy;

    x1 = Math.min(Math.max(0, x1), image.width - minSize);
    y1 = Math.min(Math.max(0, y1), image.height - minSize);
    x2 = Math.min(Math.max(minSize, x2), image.width);
    y2 = Math.min(Math.max(minSize, y2), image.height);

    if (x2 - x1 < minSize) {
      if (drag.handle.includes("w")) x1 = x2 - minSize;
      else x2 = x1 + minSize;
    }
    if (y2 - y1 < minSize) {
      if (drag.handle.includes("n")) y1 = y2 - minSize;
      else y2 = y1 + minSize;
    }

    onChange(clampCrop({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, image.width, image.height));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handles: Array<{ id: CropHandle; className: string }> = [
    { id: "nw", className: "-left-1.5 -top-1.5 cursor-nwse-resize" },
    { id: "n", className: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize" },
    { id: "ne", className: "-right-1.5 -top-1.5 cursor-nesw-resize" },
    { id: "e", className: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
    { id: "se", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
    { id: "s", className: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
    { id: "sw", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
    { id: "w", className: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
  ];

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20 select-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="absolute bg-black/45" style={{ left: 0, top: 0, width: "100%", height: `${top}%` }} />
      <div className="absolute bg-black/45" style={{ left: 0, top: `${top}%`, width: `${left}%`, height: `${height}%` }} />
      <div className="absolute bg-black/45" style={{ left: `${left + width}%`, top: `${top}%`, right: 0, height: `${height}%` }} />
      <div className="absolute bg-black/45" style={{ left: 0, top: `${top + height}%`, width: "100%", bottom: 0 }} />

      <div
        className="absolute cursor-move border-2 border-primary bg-primary/5 shadow-[0_0_0_1px_rgba(255,255,255,0.75)]"
        style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
        onPointerDown={event => startDrag(event, "move")}
      >
        <div className="pointer-events-none absolute inset-x-1/3 top-0 h-full border-x border-white/65" />
        <div className="pointer-events-none absolute inset-y-1/3 left-0 w-full border-y border-white/65" />
        {handles.map(handle => (
          <div
            key={handle.id}
            className={cn(
              "absolute h-3 w-3 rounded-[2px] border border-white bg-primary shadow-sm",
              handle.className
            )}
            onPointerDown={event => startDrag(event, handle.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PreviewArea() {
  const activeModule = useAppStore(state => state.activeModule);
  const cropAngle = useAppStore(state => state.cropAngle);
  const cropRegion = useAppStore(state => state.cropRegion);
  const cropTransform = useAppStore(state => state.cropTransform);
  const currentImage = useAppStore(state => state.currentImage);
  const previewUrl = useAppStore(state => state.previewUrl);
  const resizeSettings = useAppStore(state => state.resizeSettings);
  const setCropRegion = useAppStore(state => state.setCropRegion);
  const setCropAngle = useAppStore(state => state.setCropAngle);
  const setCropTransform = useAppStore(state => state.setCropTransform);
  const setCurrentImage = useAppStore(state => state.setCurrentImage);
  const setResizeSettings = useAppStore(state => state.setResizeSettings);

  // Measure the available preview area so the crop container never overflows
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = previewAreaRef.current;
    if (!el) return;
    const sync = () => setAreaSize({ w: el.clientWidth, h: el.clientHeight });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!currentImage || !previewUrl) return null;
  const region = cropRegion ?? { x: 0, y: 0, w: currentImage.width, h: currentImage.height };
  // effective rotation angle: quick-rotate transforms take precedence over the arbitrary angle slider
  const transformAngle = cropTransform === "rotate90" ? 90 : cropTransform === "rotate180" ? 180 : cropTransform === "rotate270" ? 270 : 0;
  const effectiveAngle = transformAngle || cropAngle;
  const cropBounds = rotatedBounds(currentImage.width, currentImage.height, effectiveAngle);

  // Compute explicit pixel size so the container fits within the available area on both axes.
  // Using a fixed `width` + CSS max-h-full breaks aspect ratio when height is the constraint.
  const PAD = 48; // p-6 = 24px × 2
  const availW = Math.max(1, areaSize.w - PAD);
  const availH = Math.max(1, areaSize.h - PAD);
  const cropDisplayScale = areaSize.w > 0
    ? Math.min(1, availW / cropBounds.width, availH / cropBounds.height)
    : 1;
  const cropDisplayW = cropBounds.width * cropDisplayScale;
  const cropDisplayH = cropBounds.height * cropDisplayScale;

  const cropPreviewStyle = activeModule === "crop" ? {
    width: `${cropDisplayW}px`,
    height: `${cropDisplayH}px`,
  } : undefined;
  const cropImageStyle = activeModule === "crop" ? {
    transform: cropTransform ? cropTransformStyle(cropTransform) : `rotate(${cropAngle}deg)`,
    width: `${(currentImage.width / cropBounds.width) * 100}%`,
    height: `${(currentImage.height / cropBounds.height) * 100}%`,
  } : undefined;

  return (
    <motion.div className="relative flex flex-1 flex-col overflow-hidden"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <div ref={previewAreaRef} className="relative flex flex-1 items-center justify-center overflow-hidden p-6"
        style={{
          backgroundImage:
            "linear-gradient(45deg,#e5e7eb 25%,transparent 25%)," +
            "linear-gradient(-45deg,#e5e7eb 25%,transparent 25%)," +
            "linear-gradient(45deg,transparent 75%,#e5e7eb 75%)," +
            "linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
        }}>
        <div className="absolute inset-0 bg-white/60 dark:bg-black/60" />
        {activeModule === "resize" && resizeSettings ? (
          <ResizePreview
            image={currentImage}
            previewUrl={previewUrl}
            settings={resizeSettings}
            onUpdate={patch => setResizeSettings({ ...resizeSettings, ...patch })}
          />
        ) : (
          <div
            className="relative z-10 overflow-hidden rounded-lg shadow-md"
            style={cropPreviewStyle}
          >
            <img
              src={previewUrl}
              alt="preview"
              className={cn(
                "block select-none object-contain",
                activeModule === "crop" ? "absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2" : "max-h-full max-w-full"
              )}
              style={cropImageStyle}
            />
            {activeModule === "crop" && (
              <button
                type="button"
                title="Rotate preview"
                onClick={() => {
                  setCropTransform(null);
                  setCropAngle((cropAngle + 90) % 360);
                }}
                className="absolute right-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <RotateCw size={16} />
              </button>
            )}
            {activeModule === "crop" && !cropTransform && cropAngle === 0 && (
              <CropOverlay
                image={currentImage}
                region={region}
                onChange={next => setCropRegion(next)}
              />
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border bg-background px-4 py-2 shrink-0">
        <span className="text-[11px] text-muted-foreground font-mono">
          {currentImage.width} × {currentImage.height}px · {currentImage.format} · {formatBytes(currentImage.file_size)}
        </span>
        <button onClick={() => setCurrentImage(null)}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1">
          × Clear
        </button>
      </div>
    </motion.div>
  );
}

export default function App() {
  const theme = useAppStore(state => state.theme);
  const currentImage = useAppStore(state => state.currentImage);
  const [dragging, setDragging] = useState(false);

  // Theme sync
  useEffect(() => {
    const apply = (dark: boolean) => document.documentElement.classList.toggle("dark", dark);
    if (theme === "dark") apply(true);
    else if (theme === "light") apply(false);
    else apply(window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = (e: MediaQueryListEvent) => document.documentElement.classList.toggle("dark", e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [theme]);

  // Ctrl+O global shortcut
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        const path = await pickOpenImage();
        if (path) loadImage(path);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Tauri drag-drop events
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const unsubs: (() => void)[] = [];

    win.onDragDropEvent(event => {
      const type = event.payload.type;
      if (type === "enter" || type === "over") {
        setDragging(true);
      } else if (type === "leave") {
        setDragging(false);
      } else if (type === "drop") {
        setDragging(false);
        const paths = (event.payload as { type: "drop"; paths: string[] }).paths;
        const img = paths.find(isImagePath);
        if (img) loadImage(img);
      }
    }).then(fn => unsubs.push(fn));

    return () => unsubs.forEach(fn => fn());
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {currentImage ? (
              <motion.div key="workspace" className="flex flex-1 overflow-hidden"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}>
                <div className="flex flex-[3] flex-col overflow-hidden border-r border-border">
                  <PreviewArea />
                </div>
                <div className="flex flex-[2] flex-col overflow-y-auto min-w-[240px] max-w-[320px]">
                  <ActivePanel />
                </div>
              </motion.div>
            ) : (
              <motion.div key="dropzone" className="flex flex-1"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}>
                <DropZone dragging={dragging} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
      <Statusbar />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
