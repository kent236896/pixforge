use base64::Engine as _;
use image::{DynamicImage, GenericImageView, ImageReader};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

// ─── Shared types ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageInfo {
    pub path: String,
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub color_space: String,
    pub bit_depth: u32,
}

#[derive(Debug, Serialize)]
pub struct ProcessResult {
    pub output_path: String,
    pub info: ImageInfo,
    pub original_size: u64,
}

// ─── Stage-1 commands ──────────────────────────────────────────────────────

/// Read basic metadata from an image file.
pub fn get_info(path: &str) -> Result<ImageInfo, String> {
    let p = Path::new(path);
    let file_size = p.metadata().map(|m| m.len()).unwrap_or(0);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    if ext == "svg" {
        let (w, h) = svg_dimensions(path).unwrap_or((0, 0));
        return Ok(ImageInfo {
            path: path.to_string(),
            format: "SVG".into(),
            width: w,
            height: h,
            file_size,
            color_space: "Vector".into(),
            bit_depth: 0,
        });
    }

    let reader = ImageReader::open(p)
        .map_err(|e| format!("Cannot open: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("Cannot detect format: {e}"))?;

    let format = reader.format().map(format_name).unwrap_or_else(|| ext.to_uppercase());
    let img = reader.decode().map_err(|e| format!("Decode error: {e}"))?;
    let (width, height) = img.dimensions();
    let (color_space, bit_depth) = color_info(img.color());

    Ok(ImageInfo { path: path.to_string(), format, width, height, file_size, color_space, bit_depth })
}

/// Generate a thumbnail as a base64-encoded PNG data URL.
pub fn generate_preview(path: &str, max_size: u32) -> Result<String, String> {
    let p = Path::new(path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    let img: DynamicImage = if ext == "svg" {
        render_svg(path, max_size)?
    } else {
        image::open(p).map_err(|e| format!("Cannot open: {e}"))?
    };

    let thumb = img.thumbnail(max_size, max_size);
    let mut buf: Vec<u8> = Vec::new();
    thumb
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| format!("Cannot encode preview: {e}"))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:image/png;base64,{b64}"))
}

// ─── Stage-2 commands ──────────────────────────────────────────────────────

/// Format conversion params from frontend.
#[derive(Debug, Deserialize)]
pub struct ConvertParams {
    pub format: String,
    pub quality: u8,
    pub bg_color: Option<[u8; 3]>,
}

pub fn do_convert(src: &str, dst: &str, p: ConvertParams) -> Result<ProcessResult, String> {
    let original_size = file_size(src);
    let img = open_image(src)?;

    let fmt = parse_format(&p.format)?;

    let img = match fmt {
        image::ImageFormat::Jpeg => flatten_alpha(img, p.bg_color.unwrap_or([255, 255, 255])),
        _ => img,
    };

    match fmt {
        image::ImageFormat::Jpeg => {
            let mut w = buf_writer(dst)?;
            let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, p.quality);
            img.write_with_encoder(enc).map_err(|e| format!("JPEG encode: {e}"))?;
        }
        _ => img.save_with_format(dst, fmt).map_err(|e| format!("Save: {e}"))?,
    }

    Ok(ProcessResult { output_path: dst.to_string(), info: get_info(dst)?, original_size })
}

/// Resize params from frontend.
#[derive(Debug, Deserialize, Clone)]
pub struct ResizeParams {
    pub mode: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub percent: Option<f32>,
    pub longest: Option<u32>,
    pub no_upscale: bool,
}

pub fn do_resize(src: &str, dst: &str, p: ResizeParams) -> Result<ProcessResult, String> {
    let original_size = file_size(src);
    let img = open_image(src)?;
    let (ow, oh) = img.dimensions();

    let resized = match p.mode.as_str() {
        "percent" => {
            let pct = p.percent.unwrap_or(100.0) / 100.0;
            let (nw, nh) = scale(ow, oh, pct, p.no_upscale);
            img.resize(nw, nh, image::imageops::FilterType::Lanczos3)
        }
        "exact" => {
            let (nw, nh) = (p.width.unwrap_or(ow), p.height.unwrap_or(oh));
            let (nw, nh) = no_upscale_clamp(nw, nh, ow, oh, p.no_upscale);
            img.resize_exact(nw, nh, image::imageops::FilterType::Lanczos3)
        }
        "longest" => {
            let s = p.longest.unwrap_or(ow.max(oh)) as f32;
            let pct = s / ow.max(oh) as f32;
            let (nw, nh) = scale(ow, oh, pct, p.no_upscale);
            img.resize(nw, nh, image::imageops::FilterType::Lanczos3)
        }
        "fit" => {
            let tw = p.width.unwrap_or(ow);
            let th = p.height.unwrap_or(oh);
            let pct = (tw as f32 / ow as f32).min(th as f32 / oh as f32);
            let (nw, nh) = scale(ow, oh, pct, p.no_upscale);
            img.resize(nw, nh, image::imageops::FilterType::Lanczos3)
        }
        "fill" => {
            let tw = p.width.unwrap_or(ow);
            let th = p.height.unwrap_or(oh);
            let pct = (tw as f32 / ow as f32).max(th as f32 / oh as f32);
            let rw = (ow as f32 * pct).round() as u32;
            let rh = (oh as f32 * pct).round() as u32;
            let big = img.resize_exact(rw, rh, image::imageops::FilterType::Lanczos3);
            let x = (rw.saturating_sub(tw)) / 2;
            let y = (rh.saturating_sub(th)) / 2;
            big.crop_imm(x, y, tw, th)
        }
        m => return Err(format!("Unknown resize mode: {m}")),
    };

    resized.save(dst).map_err(|e| format!("Save: {e}"))?;
    Ok(ProcessResult { output_path: dst.to_string(), info: get_info(dst)?, original_size })
}

/// Crop / rotate params.
#[derive(Debug, Deserialize)]
pub struct CropRotateParams {
    pub operation: String,
    pub x: Option<u32>,
    pub y: Option<u32>,
    pub w: Option<u32>,
    pub h: Option<u32>,
    pub angle: Option<f32>,
}

pub fn do_crop_rotate(src: &str, dst: &str, p: CropRotateParams) -> Result<ProcessResult, String> {
    let original_size = file_size(src);
    let img = open_image(src)?;

    let result = match p.operation.as_str() {
        "rotate90"  => img.rotate90(),
        "rotate180" => img.rotate180(),
        "rotate270" => img.rotate270(),
        "fliph"     => img.fliph(),
        "flipv"     => img.flipv(),
        "rotate"    => rotate_center_expand(&img, p.angle.unwrap_or(0.0)),
        "crop" => {
            let x = p.x.unwrap_or(0);
            let y = p.y.unwrap_or(0);
            let w = p.w.unwrap_or(img.width()).min(img.width().saturating_sub(x));
            let h = p.h.unwrap_or(img.height()).min(img.height().saturating_sub(y));
            img.crop_imm(x, y, w.max(1), h.max(1))
        }
        op => return Err(format!("Unknown operation: {op}")),
    };

    result.save(dst).map_err(|e| format!("Save: {e}"))?;
    Ok(ProcessResult { output_path: dst.to_string(), info: get_info(dst)?, original_size })
}

fn rotate_center_expand(img: &DynamicImage, angle_deg: f32) -> DynamicImage {
    let normalized = angle_deg.rem_euclid(360.0);
    if normalized == 0.0 {
        return img.clone();
    }

    let src = img.to_rgba8();
    let (sw, sh) = src.dimensions();
    let angle = normalized.to_radians();
    let sin = angle.sin();
    let cos = angle.cos();
    let new_w = (sw as f32 * cos.abs() + sh as f32 * sin.abs()).ceil().max(1.0) as u32;
    let new_h = (sw as f32 * sin.abs() + sh as f32 * cos.abs()).ceil().max(1.0) as u32;
    let mut out = image::RgbaImage::from_pixel(new_w, new_h, image::Rgba([0, 0, 0, 0]));

    let src_cx = (sw as f32 - 1.0) / 2.0;
    let src_cy = (sh as f32 - 1.0) / 2.0;
    let dst_cx = (new_w as f32 - 1.0) / 2.0;
    let dst_cy = (new_h as f32 - 1.0) / 2.0;

    for y in 0..new_h {
        for x in 0..new_w {
            let dx = x as f32 - dst_cx;
            let dy = y as f32 - dst_cy;
            // Inverse of clockwise rotation (matches CSS rotate(θ)):
            // forward CW: x'=cos·x-sin·y, y'=sin·x+cos·y
            // inverse (dst→src): sx=cos·dx+sin·dy, sy=-sin·dx+cos·dy
            let sx = cos * dx + sin * dy + src_cx;
            let sy = -sin * dx + cos * dy + src_cy;

            if sx >= 0.0 && sy >= 0.0 && sx <= sw as f32 - 1.0 && sy <= sh as f32 - 1.0 {
                out.put_pixel(x, y, bilinear_rgba(&src, sx, sy));
            }
        }
    }

    DynamicImage::ImageRgba8(out)
}

fn bilinear_rgba(src: &image::RgbaImage, x: f32, y: f32) -> image::Rgba<u8> {
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(src.width() - 1);
    let y1 = (y0 + 1).min(src.height() - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let p00 = src.get_pixel(x0, y0).0;
    let p10 = src.get_pixel(x1, y0).0;
    let p01 = src.get_pixel(x0, y1).0;
    let p11 = src.get_pixel(x1, y1).0;
    let mut out = [0u8; 4];

    for i in 0..4 {
        let top = p00[i] as f32 * (1.0 - tx) + p10[i] as f32 * tx;
        let bottom = p01[i] as f32 * (1.0 - tx) + p11[i] as f32 * tx;
        out[i] = (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8;
    }

    image::Rgba(out)
}

/// Optimize result with savings info.
#[derive(Debug, Serialize)]
pub struct OptimizeResult {
    pub output_path: String,
    pub info: ImageInfo,
    pub original_size: u64,
    pub saved_bytes: i64,
    pub saved_percent: f32,
}

pub fn do_optimize(src: &str, dst: &str, quality: u8) -> Result<OptimizeResult, String> {
    let original_size = file_size(src);
    let img = open_image(src)?;
    let ext = Path::new(src)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" => {
            let mut w = buf_writer(dst)?;
            let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, quality);
            img.to_rgb8().write_with_encoder(enc).map_err(|e| e.to_string())?;
        }
        "png" => img.save_with_format(dst, image::ImageFormat::Png).map_err(|e| e.to_string())?,
        "webp" => img.save_with_format(dst, image::ImageFormat::WebP).map_err(|e| e.to_string())?,
        _ => img.save(dst).map_err(|e| e.to_string())?,
    }

    let info = get_info(dst)?;
    let new_size = info.file_size as i64;
    let saved = original_size as i64 - new_size;
    let pct = if original_size > 0 { saved as f32 / original_size as f32 * 100.0 } else { 0.0 };

    Ok(OptimizeResult { output_path: dst.to_string(), info, original_size, saved_bytes: saved, saved_percent: pct })
}

// ─── Internal helpers ──────────────────────────────────────────────────────

fn open_image(path: &str) -> Result<DynamicImage, String> {
    image::open(path).map_err(|e| format!("Open '{path}': {e}"))
}

fn file_size(path: &str) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn buf_writer(path: &str) -> Result<std::io::BufWriter<std::fs::File>, String> {
    std::fs::File::create(path)
        .map(std::io::BufWriter::new)
        .map_err(|e| format!("Create '{path}': {e}"))
}

fn flatten_alpha(img: DynamicImage, bg: [u8; 3]) -> DynamicImage {
    let rgba = img.to_rgba8();
    let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
    for (x, y, px) in rgba.enumerate_pixels() {
        let a = px[3] as f32 / 255.0;
        rgb.put_pixel(x, y, image::Rgb([
            (px[0] as f32 * a + bg[0] as f32 * (1.0 - a)) as u8,
            (px[1] as f32 * a + bg[1] as f32 * (1.0 - a)) as u8,
            (px[2] as f32 * a + bg[2] as f32 * (1.0 - a)) as u8,
        ]));
    }
    DynamicImage::ImageRgb8(rgb)
}

fn scale(ow: u32, oh: u32, pct: f32, no_up: bool) -> (u32, u32) {
    let nw = (ow as f32 * pct).round() as u32;
    let nh = (oh as f32 * pct).round() as u32;
    no_upscale_clamp(nw, nh, ow, oh, no_up)
}

fn no_upscale_clamp(nw: u32, nh: u32, ow: u32, oh: u32, no_up: bool) -> (u32, u32) {
    if no_up { (nw.min(ow).max(1), nh.min(oh).max(1)) } else { (nw.max(1), nh.max(1)) }
}

fn parse_format(s: &str) -> Result<image::ImageFormat, String> {
    match s.to_uppercase().as_str() {
        "PNG"         => Ok(image::ImageFormat::Png),
        "JPEG" | "JPG" => Ok(image::ImageFormat::Jpeg),
        "WEBP"        => Ok(image::ImageFormat::WebP),
        "GIF"         => Ok(image::ImageFormat::Gif),
        "TIFF" | "TIF" => Ok(image::ImageFormat::Tiff),
        "BMP"         => Ok(image::ImageFormat::Bmp),
        other         => Err(format!("Unsupported format: {other}")),
    }
}

fn format_name(fmt: image::ImageFormat) -> String {
    match fmt {
        image::ImageFormat::Png  => "PNG",
        image::ImageFormat::Jpeg => "JPEG",
        image::ImageFormat::WebP => "WEBP",
        image::ImageFormat::Gif  => "GIF",
        image::ImageFormat::Tiff => "TIFF",
        image::ImageFormat::Bmp  => "BMP",
        image::ImageFormat::Ico  => "ICO",
        image::ImageFormat::Avif => "AVIF",
        _                        => "Unknown",
    }
    .to_string()
}

fn color_info(ct: image::ColorType) -> (String, u32) {
    match ct {
        image::ColorType::L8    => ("Grayscale".into(), 8),
        image::ColorType::L16   => ("Grayscale".into(), 16),
        image::ColorType::La8   => ("GrayAlpha".into(), 8),
        image::ColorType::La16  => ("GrayAlpha".into(), 16),
        image::ColorType::Rgb8  => ("sRGB".into(), 8),
        image::ColorType::Rgb16 => ("sRGB".into(), 16),
        image::ColorType::Rgba8 => ("sRGBA".into(), 8),
        image::ColorType::Rgba16 => ("sRGBA".into(), 16),
        image::ColorType::Rgb32F  => ("sRGB".into(), 32),
        image::ColorType::Rgba32F => ("sRGBA".into(), 32),
        _ => ("Unknown".into(), 8),
    }
}

fn svg_dimensions(path: &str) -> Option<(u32, u32)> {
    let data = std::fs::read_to_string(path).ok()?;
    let opt = resvg::usvg::Options::default();
    let tree = resvg::usvg::Tree::from_str(&data, &opt).ok()?;
    let sz = tree.size();
    Some((sz.width() as u32, sz.height() as u32))
}

fn render_svg(path: &str, max_size: u32) -> Result<DynamicImage, String> {
    let data = std::fs::read_to_string(path).map_err(|e| format!("Read SVG: {e}"))?;
    let opt = resvg::usvg::Options::default();
    let tree = resvg::usvg::Tree::from_str(&data, &opt).map_err(|e| format!("Parse SVG: {e}"))?;
    let sz = tree.size();
    let scale = (max_size as f32 / sz.width().max(sz.height())).min(1.0);
    let w = ((sz.width() * scale) as u32).max(1);
    let h = ((sz.height() * scale) as u32).max(1);
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h).ok_or("Pixmap alloc failed")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    let rgba = image::RgbaImage::from_raw(w, h, pixmap.take()).ok_or("Pixmap → image failed")?;
    Ok(DynamicImage::ImageRgba8(rgba))
}

// ─── Background Removal ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BgRemoveParams {
    pub threshold: f32,
    pub bg_mode: String,          // "transparent" | "color"
    pub bg_color: Option<[u8; 3]>,
}

// Session is stored behind Mutex because run() requires &mut self.
// Mutex<Session> is Sync because Session: Send (it contains Arc<SharedSessionInner>).
static BG_SESSION: OnceLock<Mutex<ort::session::Session>> = OnceLock::new();

fn get_or_init_session(model_path: &str) -> Result<&'static Mutex<ort::session::Session>, String> {
    if let Some(m) = BG_SESSION.get() {
        return Ok(m);
    }
    let session = ort::session::Session::builder()
        .map_err(|e| format!("ORT builder: {e}"))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Load ONNX '{model_path}': {e}"))?;
    let _ = BG_SESSION.set(Mutex::new(session));
    BG_SESSION.get().ok_or_else(|| "BG session unavailable".to_string())
}

pub fn do_bg_remove(
    src: &str,
    dst: &str,
    p: BgRemoveParams,
    model_path: &str,
) -> Result<ProcessResult, String> {
    let original_size = file_size(src);
    let img = open_image(src)?;
    let (orig_w, orig_h) = img.dimensions();

    // ── Resize to 320×320 and normalise with ImageNet mean/std ──────────────
    let resized = img.resize_exact(320, 320, image::imageops::FilterType::Lanczos3);
    let rgb = resized.to_rgb8();
    let mean = [0.485_f32, 0.456, 0.406];
    let std  = [0.229_f32, 0.224, 0.225];

    // Build flat NCHW Vec<f32>: shape [1, 3, 320, 320]
    let mut data = vec![0f32; 3 * 320 * 320];
    for y in 0..320usize {
        for x in 0..320usize {
            let px = rgb.get_pixel(x as u32, y as u32);
            data[y * 320 + x]                 = (px[0] as f32 / 255.0 - mean[0]) / std[0];
            data[320 * 320 + y * 320 + x]     = (px[1] as f32 / 255.0 - mean[1]) / std[1];
            data[2 * 320 * 320 + y * 320 + x] = (px[2] as f32 / 255.0 - mean[2]) / std[2];
        }
    }

    // Create ort Tensor from (shape, data) — no ndarray needed
    let ort_input = ort::value::Tensor::<f32>::from_array(([1i64, 3, 320, 320], data))
        .map_err(|e| e.to_string())?;

    // ── ONNX inference ───────────────────────────────────────────────────────
    let session_mutex = get_or_init_session(model_path)?;
    let mut lock = session_mutex.lock().map_err(|_| "Session lock poisoned".to_string())?;

    // Get input name as owned String before calling run() to avoid borrow conflicts
    let input_name: String = lock.inputs().first()
        .map(|i| i.name().to_string())
        .unwrap_or_else(|| "input.1".to_string());

    // inputs! returns Vec (not Result) in rc.12; pass &Tensor → &Value implements From for SessionInputValue
    let outputs = lock
        .run(ort::inputs![input_name.as_str() => &ort_input])
        .map_err(|e| format!("Inference: {e}"))?;

    // ── Extract raw mask data: shape [1,1,320,320], flat index = y*320+x ────
    let (_, raw_data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Extract output: {e}"))?;

    // Min-max normalise → GrayImage (copy data out before dropping lock+outputs)
    let (mi, ma) = raw_data.iter().fold((f32::MAX, f32::MIN), |(mn, mx), &v| (mn.min(v), mx.max(v)));
    let range = (ma - mi).max(1e-6);
    let mut mask320 = image::GrayImage::new(320, 320);
    for y in 0..320u32 {
        for x in 0..320u32 {
            let v = raw_data[(y * 320 + x) as usize];
            mask320.put_pixel(x, y, image::Luma([((v - mi) / range * 255.0) as u8]));
        }
    }
    drop(outputs);
    drop(lock);

    // ── Upsample mask to original size ───────────────────────────────────────
    let mask = DynamicImage::ImageLuma8(mask320)
        .resize_exact(orig_w, orig_h, image::imageops::FilterType::Lanczos3)
        .to_luma8();

    // ── Apply mask ───────────────────────────────────────────────────────────
    let thr = (p.threshold.clamp(0.0, 1.0) * 255.0) as u8;
    let orig_rgba = img.to_rgba8();
    let mut result = image::RgbaImage::new(orig_w, orig_h);
    for y in 0..orig_h {
        for x in 0..orig_w {
            let m = mask.get_pixel(x, y)[0];
            let s = orig_rgba.get_pixel(x, y);
            let out = if m >= thr {
                *s
            } else {
                match p.bg_mode.as_str() {
                    "color" => {
                        let c = p.bg_color.unwrap_or([255, 255, 255]);
                        image::Rgba([c[0], c[1], c[2], 255])
                    }
                    _ => image::Rgba([0, 0, 0, 0]),
                }
            };
            result.put_pixel(x, y, out);
        }
    }

    DynamicImage::ImageRgba8(result).save(dst).map_err(|e| format!("Save: {e}"))?;
    Ok(ProcessResult { output_path: dst.to_string(), info: get_info(dst)?, original_size })
}

// ─── Artistic Effects ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct EffectParams {
    pub effect: String,
    pub params: std::collections::HashMap<String, f64>,
}

pub fn do_apply_effect(src: &str, dst: &str, p: EffectParams) -> Result<ProcessResult, String> {
    let original_size = file_size(src);
    let img = open_image(src)?;
    let get = |k: &str, def: f32| p.params.get(k).copied().unwrap_or(def as f64) as f32;

    let result = match p.effect.as_str() {
        "grayscale" => fx_grayscale(&img, get("intensity", 100.0)),
        "sepia"     => fx_sepia(&img, get("intensity", 80.0)),
        "blur"      => fx_blur(&img, get("radius", 5.0)),
        "sharpen"   => fx_sharpen(&img, get("strength", 2.0)),
        "emboss"    => fx_emboss(&img, get("strength", 2.0)),
        "pixelate"  => fx_pixelate(&img, get("block_size", 10.0) as u32),
        "sketch"    => fx_sketch(&img, get("intensity", 70.0), get("blur_radius", 3.0)),
        "vignette"  => fx_vignette(&img, get("radius", 60.0), get("intensity", 70.0)),
        "neon_edge" => fx_neon_edge(&img, get("low_threshold", 30.0), get("high_threshold", 100.0)),
        "invert"    => fx_invert(&img, get("intensity", 100.0)),
        other       => return Err(format!("Unknown effect: {other}")),
    };

    result.save(dst).map_err(|e| format!("Save: {e}"))?;
    Ok(ProcessResult { output_path: dst.to_string(), info: get_info(dst)?, original_size })
}

// ── shared blend helper ────────────────────────────────────────────────────────

fn blend_rgba(a: &image::RgbaImage, b: &image::RgbaImage, t: f32) -> DynamicImage {
    let (w, h) = a.dimensions();
    let mut out = a.clone();
    for y in 0..h {
        for x in 0..w {
            let ap = a.get_pixel(x, y);
            let bp = b.get_pixel(x, y);
            out.put_pixel(x, y, image::Rgba([
                lerp(ap[0], bp[0], t),
                lerp(ap[1], bp[1], t),
                lerp(ap[2], bp[2], t),
                ap[3],
            ]));
        }
    }
    DynamicImage::ImageRgba8(out)
}

#[inline]
fn lerp(a: u8, b: u8, t: f32) -> u8 {
    (a as f32 + (b as f32 - a as f32) * t).round().clamp(0.0, 255.0) as u8
}

// ── effect implementations ─────────────────────────────────────────────────────

fn fx_grayscale(img: &DynamicImage, intensity: f32) -> DynamicImage {
    let gray = img.grayscale().to_rgba8();
    blend_rgba(&img.to_rgba8(), &gray, (intensity / 100.0).clamp(0.0, 1.0))
}

fn fx_sepia(img: &DynamicImage, intensity: f32) -> DynamicImage {
    let orig = img.to_rgba8();
    let mut s = orig.clone();
    for px in s.pixels_mut() {
        let (r, g, b) = (px[0] as f32, px[1] as f32, px[2] as f32);
        px[0] = (r * 0.393 + g * 0.769 + b * 0.189).min(255.0) as u8;
        px[1] = (r * 0.349 + g * 0.686 + b * 0.168).min(255.0) as u8;
        px[2] = (r * 0.272 + g * 0.534 + b * 0.131).min(255.0) as u8;
    }
    blend_rgba(&orig, &s, (intensity / 100.0).clamp(0.0, 1.0))
}

fn fx_blur(img: &DynamicImage, radius: f32) -> DynamicImage {
    let rgba = img.to_rgba8();
    DynamicImage::ImageRgba8(imageproc::filter::gaussian_blur_f32(&rgba, radius.max(0.1)))
}

fn fx_sharpen(img: &DynamicImage, strength: f32) -> DynamicImage {
    let rgba = img.to_rgba8();
    let blurred = imageproc::filter::gaussian_blur_f32(&rgba, 1.0);
    let (w, h) = rgba.dimensions();
    let mut out = rgba.clone();
    for y in 0..h {
        for x in 0..w {
            let o = rgba.get_pixel(x, y);
            let b = blurred.get_pixel(x, y);
            for c in 0..3 {
                out.get_pixel_mut(x, y)[c] =
                    (o[c] as f32 + strength * (o[c] as f32 - b[c] as f32)).clamp(0.0, 255.0) as u8;
            }
        }
    }
    DynamicImage::ImageRgba8(out)
}

fn fx_emboss(img: &DynamicImage, strength: f32) -> DynamicImage {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut out = rgba.clone();
    for y in 1..h.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let tl = rgba.get_pixel(x - 1, y - 1);
            let br = rgba.get_pixel(x + 1, y + 1);
            for c in 0..3 {
                out.get_pixel_mut(x, y)[c] =
                    ((br[c] as f32 - tl[c] as f32) * strength + 128.0).clamp(0.0, 255.0) as u8;
            }
        }
    }
    DynamicImage::ImageRgba8(out)
}

fn fx_pixelate(img: &DynamicImage, block_size: u32) -> DynamicImage {
    let bs = block_size.max(2);
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut out = rgba.clone();
    let mut by = 0u32;
    while by < h {
        let bh = bs.min(h - by);
        let mut bx = 0u32;
        while bx < w {
            let bw = bs.min(w - bx);
            let n = (bw * bh) as u32;
            let (mut sr, mut sg, mut sb, mut sa) = (0u32, 0u32, 0u32, 0u32);
            for dy in 0..bh {
                for dx in 0..bw {
                    let p = rgba.get_pixel(bx + dx, by + dy);
                    sr += p[0] as u32; sg += p[1] as u32;
                    sb += p[2] as u32; sa += p[3] as u32;
                }
            }
            let avg = image::Rgba([(sr/n) as u8, (sg/n) as u8, (sb/n) as u8, (sa/n) as u8]);
            for dy in 0..bh {
                for dx in 0..bw { out.put_pixel(bx + dx, by + dy, avg); }
            }
            bx += bs;
        }
        by += bs;
    }
    DynamicImage::ImageRgba8(out)
}

fn fx_sketch(img: &DynamicImage, intensity: f32, blur_radius: f32) -> DynamicImage {
    let gray = img.to_luma8();
    let (w, h) = gray.dimensions();

    // invert
    let mut inv = gray.clone();
    for px in inv.pixels_mut() { px[0] = 255 - px[0]; }

    // blur the inverted layer
    let blurred = imageproc::filter::gaussian_blur_f32(&inv, blur_radius.max(0.1));

    // colour-dodge: result = gray / (1 − blur/255)
    let mut dodged = image::GrayImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let g = gray.get_pixel(x, y)[0] as f32;
            let b = blurred.get_pixel(x, y)[0] as f32;
            let v = if b < 255.0 { (g / (1.0 - b / 255.0)).min(255.0) } else { 255.0 };
            dodged.put_pixel(x, y, image::Luma([v as u8]));
        }
    }

    let sketch_rgba = DynamicImage::ImageLuma8(dodged).to_rgba8();
    blend_rgba(&img.to_rgba8(), &sketch_rgba, (intensity / 100.0).clamp(0.0, 1.0))
}

fn fx_vignette(img: &DynamicImage, radius: f32, intensity: f32) -> DynamicImage {
    let mut rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let cx = w as f32 / 2.0;
    let cy = h as f32 / 2.0;
    let max_d = (cx * cx + cy * cy).sqrt();
    let thresh = (radius / 100.0).clamp(0.0, 1.0) * max_d;
    let factor = (intensity / 100.0).clamp(0.0, 1.0);
    for y in 0..h {
        for x in 0..w {
            let dist = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            if dist > thresh {
                let t = ((dist - thresh) / (max_d - thresh + 1e-6)).clamp(0.0, 1.0);
                let dark = 1.0 - t * factor;
                let px = rgba.get_pixel_mut(x, y);
                px[0] = (px[0] as f32 * dark) as u8;
                px[1] = (px[1] as f32 * dark) as u8;
                px[2] = (px[2] as f32 * dark) as u8;
            }
        }
    }
    DynamicImage::ImageRgba8(rgba)
}

fn fx_neon_edge(img: &DynamicImage, low: f32, high: f32) -> DynamicImage {
    let gray = img.to_luma8();
    let edges = imageproc::edges::canny(&gray, low.max(1.0), high.max(2.0));
    let (w, h) = edges.dimensions();
    let mut out = image::RgbaImage::from_pixel(w, h, image::Rgba([0, 0, 0, 255]));
    for (x, y, px) in edges.enumerate_pixels() {
        if px[0] > 0 {
            out.put_pixel(x, y, image::Rgba([0, 230, 255, 255]));
        }
    }
    DynamicImage::ImageRgba8(out)
}

fn fx_invert(img: &DynamicImage, intensity: f32) -> DynamicImage {
    let orig = img.to_rgba8();
    let mut inv = orig.clone();
    for px in inv.pixels_mut() {
        px[0] = 255 - px[0];
        px[1] = 255 - px[1];
        px[2] = 255 - px[2];
    }
    blend_rgba(&orig, &inv, (intensity / 100.0).clamp(0.0, 1.0))
}

// ─── Batch Processing ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct BatchConvertParams {
    pub format: String,
    pub quality: u8,
}

#[derive(Debug, Deserialize, Clone)]
pub struct BatchOperation {
    pub kind: String,                        // "convert" | "resize" | "optimize"
    pub convert: Option<BatchConvertParams>,
    pub resize: Option<ResizeParams>,
    pub quality: Option<u8>,
}

#[derive(Debug, Serialize, Clone)]
pub struct BatchFileResult {
    pub index: usize,
    pub src_path: String,
    pub status: String,                      // "processing" | "done" | "error"
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub done: usize,
    pub total: usize,
}

pub fn run_batch(
    src_paths: Vec<String>,
    op: BatchOperation,
    out_dir: &str,
    name_template: &str,
    cancel: Arc<std::sync::atomic::AtomicBool>,
    on_progress: impl Fn(BatchFileResult) + Send + Sync,
) -> Result<(), String> {
    std::fs::create_dir_all(out_dir)
        .map_err(|e| format!("Cannot create output dir: {e}"))?;

    let total = src_paths.len();
    let done_counter = Arc::new(AtomicUsize::new(0));
    let on_progress = &on_progress;

    src_paths.par_iter().enumerate().for_each(|(idx, src)| {
        if cancel.load(Ordering::Relaxed) {
            return;
        }

        on_progress(BatchFileResult {
            index: idx,
            src_path: src.clone(),
            status: "processing".into(),
            output_path: None,
            error: None,
            done: done_counter.load(Ordering::SeqCst),
            total,
        });

        let result: Result<String, String> = (|| -> Result<String, String> {
            let dst = resolve_batch_output(src, &op, out_dir, name_template, idx)?;
            match op.kind.as_str() {
                "convert" => {
                    let p = op.convert.as_ref().ok_or("Missing convert params")?;
                    do_convert(src, &dst, ConvertParams {
                        format: p.format.clone(),
                        quality: p.quality,
                        bg_color: None,
                    })?;
                }
                "resize" => {
                    let p = op.resize.clone().ok_or("Missing resize params")?;
                    do_resize(src, &dst, p)?;
                }
                "optimize" => {
                    do_optimize(src, &dst, op.quality.unwrap_or(80))?;
                }
                k => return Err(format!("Unknown op: {k}")),
            }
            Ok(dst)
        })();

        let done = done_counter.fetch_add(1, Ordering::SeqCst) + 1;

        match result {
            Ok(out) => on_progress(BatchFileResult {
                index: idx,
                src_path: src.clone(),
                status: "done".into(),
                output_path: Some(out),
                error: None,
                done,
                total,
            }),
            Err(e) => on_progress(BatchFileResult {
                index: idx,
                src_path: src.clone(),
                status: "error".into(),
                output_path: None,
                error: Some(e),
                done,
                total,
            }),
        }
    });

    Ok(())
}

// Expand a mix of file paths and folder paths into a flat list of image paths.
pub fn expand_drop_paths(paths: Vec<String>) -> Vec<String> {
    const IMG_EXTS: &[&str] = &[
        "png","jpg","jpeg","webp","avif","gif","tiff","tif","bmp","ico","svg","heic","heif",
    ];

    fn is_image(p: &Path) -> bool {
        p.extension()
            .and_then(|e| e.to_str())
            .map(|e| IMG_EXTS.contains(&e.to_lowercase().as_str()))
            .unwrap_or(false)
    }

    fn collect(p: &Path, out: &mut Vec<String>) {
        if p.is_dir() {
            if let Ok(entries) = std::fs::read_dir(p) {
                let mut children: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                children.sort();
                for child in children {
                    collect(&child, out);
                }
            }
        } else if is_image(p) {
            out.push(p.to_string_lossy().to_string());
        }
    }

    let mut result = Vec::new();
    for raw in paths {
        collect(Path::new(&raw), &mut result);
    }
    result
}

fn resolve_batch_output(
    src: &str,
    op: &BatchOperation,
    out_dir: &str,
    template: &str,
    idx: usize,
) -> Result<String, String> {
    let src_path = Path::new(src);
    let stem = src_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");

    let ext: String = match op.kind.as_str() {
        "convert" => {
            let fmt = op.convert.as_ref()
                .map(|c| c.format.to_lowercase())
                .unwrap_or_else(|| "png".into());
            if fmt == "jpeg" { "jpg".into() } else { fmt }
        }
        _ => src_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("jpg")
            .to_lowercase(),
    };

    let mut filename = template
        .replace("{name}", stem)
        .replace("{index}", &(idx + 1).to_string())
        .replace("{ext}", &ext);

    if !filename.contains('.') {
        filename = format!("{filename}.{ext}");
    }

    Ok(Path::new(out_dir)
        .join(filename)
        .to_string_lossy()
        .to_string())
}
