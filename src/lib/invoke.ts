import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

export interface ImageInfo {
  path: string;
  format: string;
  width: number;
  height: number;
  file_size: number;
  color_space: string;
  bit_depth: number;
}

export interface ProcessResult {
  output_path: string;
  info: ImageInfo;
  original_size: number;
}

export interface OptimizeResult extends ProcessResult {
  saved_bytes: number;
  saved_percent: number;
}

// ─── Stage-1 ───────────────────────────────────────────────────────────────

export function getImageInfo(path: string): Promise<ImageInfo> {
  return invoke("get_image_info", { path });
}

export function generatePreview(path: string, maxSize = 800): Promise<string> {
  return invoke("generate_preview", { path, maxSize });
}

// ─── Stage-2 ───────────────────────────────────────────────────────────────

export interface ConvertParams {
  format: string;
  quality: number;
  bg_color?: [number, number, number];
}

export interface ResizeParams {
  mode: "percent" | "exact" | "longest" | "fit" | "fill";
  width?: number;
  height?: number;
  percent?: number;
  longest?: number;
  no_upscale: boolean;
}

export interface CropRotateParams {
  operation: "rotate90" | "rotate180" | "rotate270" | "fliph" | "flipv" | "crop" | "rotate";
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  angle?: number;
}

export function convertImage(src: string, dst: string, params: ConvertParams): Promise<ProcessResult> {
  return invoke("convert_image", { src, dst, params });
}

export function resizeImage(src: string, dst: string, params: ResizeParams): Promise<ProcessResult> {
  return invoke("resize_image", { src, dst, params });
}

export function cropRotateImage(src: string, dst: string, params: CropRotateParams): Promise<ProcessResult> {
  return invoke("crop_rotate_image", { src, dst, params });
}

export function optimizeImage(src: string, dst: string, quality: number): Promise<OptimizeResult> {
  return invoke("optimize_image", { src, dst, quality });
}

// ─── Save dialog helper ────────────────────────────────────────────────────

export async function pickSavePath(
  srcPath: string,
  ext: string,
  suffix = ""
): Promise<string | null> {
  const name = srcPath.replace(/\\/g, "/").split("/").pop() ?? "image";
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return save({
    defaultPath: `${stem}${suffix}.${ext.toLowerCase()}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext.toLowerCase()] }],
  });
}

// ─── Utilities ─────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatExt(format: string): string {
  return format.toLowerCase() === "jpeg" ? "jpg" : format.toLowerCase();
}

export async function pickOpenImage(): Promise<string | null> {
  const result = await open({
    multiple: false,
    filters: [{
      name: "Images",
      extensions: ["png","jpg","jpeg","webp","avif","gif","tiff","tif","bmp","svg","ico"],
    }],
  });
  return typeof result === "string" ? result : null;
}
