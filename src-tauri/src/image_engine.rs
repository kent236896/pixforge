use base64::Engine as _;
use image::{DynamicImage, GenericImageView, ImageReader};
use serde::{Deserialize, Serialize};
use std::path::Path;

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
#[derive(Debug, Deserialize)]
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
