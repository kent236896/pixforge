mod image_engine;
use image_engine::{ConvertParams, CropRotateParams, ResizeParams};

// ─── Stage-1 ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_image_info(path: String) -> Result<image_engine::ImageInfo, String> {
    tauri::async_runtime::spawn_blocking(move || image_engine::get_info(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn generate_preview(path: String, max_size: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || image_engine::generate_preview(&path, max_size))
        .await
        .map_err(|e| e.to_string())?
}

// ─── Stage-2 ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn convert_image(
    src: String,
    dst: String,
    params: ConvertParams,
) -> Result<image_engine::ProcessResult, String> {
    tauri::async_runtime::spawn_blocking(move || image_engine::do_convert(&src, &dst, params))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn resize_image(
    src: String,
    dst: String,
    params: ResizeParams,
) -> Result<image_engine::ProcessResult, String> {
    tauri::async_runtime::spawn_blocking(move || image_engine::do_resize(&src, &dst, params))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn crop_rotate_image(
    src: String,
    dst: String,
    params: CropRotateParams,
) -> Result<image_engine::ProcessResult, String> {
    tauri::async_runtime::spawn_blocking(move || image_engine::do_crop_rotate(&src, &dst, params))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn optimize_image(
    src: String,
    dst: String,
    quality: u8,
) -> Result<image_engine::OptimizeResult, String> {
    tauri::async_runtime::spawn_blocking(move || image_engine::do_optimize(&src, &dst, quality))
        .await
        .map_err(|e| e.to_string())?
}

// ─── App entry ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_image_info,
            generate_preview,
            convert_image,
            resize_image,
            crop_rotate_image,
            optimize_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
