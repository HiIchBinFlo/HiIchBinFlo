//! Design Studio (Phase 6): applies a user-edited image (recolored, a
//! user-uploaded picture, or hand-painted) back onto a real `.ytd`'s named
//! texture. Builds on two things already proven in this project: the native
//! Rust DDS encode/decode pair (`texture_encode.rs`/`texture_decode.rs`) and
//! the sidecar's "verify before write" pattern
//! (`sidecar/CodeWalkerBridge/Commands.cs::ReplaceTexture`, the same shape
//! as `RepairYtd`/`RepairYdd`). This module is the glue: decode the edited
//! PNG the frontend sends, encode it to a real DDS, hand that DDS's path to
//! the sidecar, and return the same `RepairResult` shape the write-back
//! commands already use.

use crate::commands::repair::RepairResult;
use crate::error::{AppError, AppResult};
use crate::sidecar::run_sidecar;
use crate::texture_encode;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use uuid::Uuid;

/// `edited_png_base64` is the full edited image (recolor/upload/paint result)
/// as a base64-encoded PNG — whatever dimensions the editor produced; it does
/// not need to match the original texture's size, since the sidecar replaces
/// the texture's dimensions along with its pixels. `input_path`/`output_path`
/// may be the same path for an in-place edit, matching `repair_ytd`/`repair_ydd`.
#[tauri::command]
pub async fn apply_texture_edit(
    app: tauri::AppHandle,
    input_path: String,
    texture_name: String,
    edited_png_base64: String,
    output_path: String,
) -> AppResult<RepairResult> {
    let png_bytes = BASE64
        .decode(edited_png_base64)
        .map_err(|e| AppError(format!("Edited image was not valid base64: {e}")))?;
    let image = image::load_from_memory(&png_bytes)
        .map_err(|e| AppError(format!("Edited image was not a valid image: {e}")))?
        .to_rgba8();
    let (width, height) = (image.width(), image.height());
    let dds_bytes = texture_encode::encode_rgba_to_dds(width, height, image.as_raw())?;

    let temp_dds_path = std::env::temp_dir().join(format!("fcstudio-texture-edit-{}.dds", Uuid::new_v4()));
    std::fs::write(&temp_dds_path, &dds_bytes)
        .map_err(|e| AppError(format!("Failed to write a temporary .dds file: {e}")))?;

    let result = run_sidecar(
        &app,
        vec![
            "replace-texture".to_string(),
            input_path,
            texture_name,
            temp_dds_path.to_string_lossy().to_string(),
            output_path,
        ],
    )
    .await;

    let _ = std::fs::remove_file(&temp_dds_path);
    result
}
