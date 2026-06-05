import { create } from "zustand";
import type { ImageInfo } from "@/lib/invoke";

export type Module = "convert" | "resize" | "crop" | "batch" | "optimize";
export type Theme = "light" | "dark" | "system";
export interface CropRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type CropTransform = "rotate90" | "rotate180" | "rotate270" | "fliph" | "flipv" | null;
export interface ResizeSettings {
  width: number;
  height: number;
  noUpscale: boolean;
  lockAspect: boolean;
}

interface AppState {
  activeModule: Module;
  theme: Theme;
  currentImage: ImageInfo | null;
  previewUrl: string | null;
  cropRegion: CropRegion | null;
  cropTransform: CropTransform;
  cropAngle: number;
  resizeSettings: ResizeSettings | null;
  setModule: (module: Module) => void;
  setTheme: (theme: Theme) => void;
  setCurrentImage: (info: ImageInfo | null, previewUrl?: string | null) => void;
  setCropRegion: (region: CropRegion) => void;
  setCropTransform: (transform: CropTransform) => void;
  setCropAngle: (angle: number) => void;
  setResizeSettings: (settings: ResizeSettings) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeModule: "convert",
  theme: "system",
  currentImage: null,
  previewUrl: null,
  cropRegion: null,
  cropTransform: null,
  cropAngle: 0,
  resizeSettings: null,
  setModule: (module) => set({ activeModule: module }),
  setTheme: (theme) => set({ theme }),
  setCurrentImage: (info, previewUrl = null) => set({
    currentImage: info,
    previewUrl,
    cropRegion: info ? { x: 0, y: 0, w: info.width, h: info.height } : null,
    cropTransform: null,
    cropAngle: 0,
    resizeSettings: info ? {
      width: info.width,
      height: info.height,
      noUpscale: true,
      lockAspect: true,
    } : null,
  }),
  setCropRegion: (region) => set({ cropRegion: region }),
  setCropTransform: (transform) => set({ cropTransform: transform }),
  setCropAngle: (angle) => set({ cropAngle: angle }),
  setResizeSettings: (settings) => set({ resizeSettings: settings }),
}));
