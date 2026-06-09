import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
export { listen } from "@tauri-apps/api/event";
export type { UnlistenFn } from "@tauri-apps/api/event";

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

// ─── BgEffect ──────────────────────────────────────────────────────────────

export interface BgRemoveParams {
  threshold: number;              // 0.0–1.0
  bg_mode: "transparent" | "color";
  bg_color?: [number, number, number];
}

export interface EffectParams {
  effect: string;
  params: Record<string, number>;
}

export function bgRemoveImage(src: string, dst: string, params: BgRemoveParams): Promise<ProcessResult> {
  return invoke("bg_remove_image", { src, dst, params });
}

export function applyEffect(src: string, dst: string, params: EffectParams): Promise<ProcessResult> {
  return invoke("apply_effect", { src, dst, params });
}

// ─── Batch ─────────────────────────────────────────────────────────────────

export interface BatchConvertParams {
  format: string;
  quality: number;
}

export interface BatchOperation {
  kind: "convert" | "resize" | "optimize";
  convert?: BatchConvertParams;
  resize?: ResizeParams;
  quality?: number;
}

export interface BatchFileResult {
  index: number;
  src_path: string;
  status: "processing" | "done" | "error";
  output_path: string | null;
  error: string | null;
  done: number;
  total: number;
}

export function expandDropPaths(paths: string[]): Promise<string[]> {
  return invoke("expand_drop_paths", { paths });
}

export function runBatch(
  srcPaths: string[],
  op: BatchOperation,
  outDir: string,
  nameTemplate: string,
): Promise<void> {
  return invoke("run_batch", { srcPaths, op, outDir, nameTemplate });
}

export function cancelBatch(): Promise<void> {
  return invoke("cancel_batch");
}

export async function pickDirectory(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

export async function pickOpenImages(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [{
      name: "Images",
      extensions: ["png","jpg","jpeg","webp","avif","gif","tiff","tif","bmp","svg","ico"],
    }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
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
