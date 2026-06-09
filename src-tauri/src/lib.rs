mod image_engine;
use image_engine::{BatchOperation, BgRemoveParams, ConvertParams, CropRotateParams, EffectParams, ResizeParams};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

struct BatchCancelState(Mutex<Arc<AtomicBool>>);

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

// ─── BgEffect ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn bg_remove_image(
    app: tauri::AppHandle,
    src: String,
    dst: String,
    params: BgRemoveParams,
) -> Result<image_engine::ProcessResult, String> {
    let model_path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join("silueta.onnx")
        .to_string_lossy()
        .to_string();
    tauri::async_runtime::spawn_blocking(move || {
        image_engine::do_bg_remove(&src, &dst, params, &model_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn apply_effect(
    src: String,
    dst: String,
    params: EffectParams,
) -> Result<image_engine::ProcessResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        image_engine::do_apply_effect(&src, &dst, params)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Utilities ─────────────────────────────────────────────────────────────

#[tauri::command]
fn expand_drop_paths(paths: Vec<String>) -> Vec<String> {
    image_engine::expand_drop_paths(paths)
}

// ─── Batch ─────────────────────────────────────────────────────────────────

#[tauri::command]
async fn run_batch(
    app: tauri::AppHandle,
    state: tauri::State<'_, BatchCancelState>,
    src_paths: Vec<String>,
    op: BatchOperation,
    out_dir: String,
    name_template: String,
) -> Result<(), String> {
    let cancel = {
        let mut guard = state.0.lock().map_err(|_| "State lock poisoned")?;
        let token = Arc::new(AtomicBool::new(false));
        *guard = token.clone();
        token
    };

    tauri::async_runtime::spawn_blocking(move || {
        image_engine::run_batch(src_paths, op, &out_dir, &name_template, cancel, |result| {
            let _ = app.emit("batch://progress", result);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_batch(state: tauri::State<'_, BatchCancelState>) {
    if let Ok(guard) = state.0.lock() {
        guard.store(true, Ordering::Relaxed);
    }
}

// ─── App entry ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BatchCancelState(Mutex::new(Arc::new(AtomicBool::new(false)))))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_image_info,
            generate_preview,
            convert_image,
            resize_image,
            crop_rotate_image,
            optimize_image,
            bg_remove_image,
            apply_effect,
            expand_drop_paths,
            run_batch,
            cancel_batch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
