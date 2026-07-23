//! Tauri commands backing Phase 3's isolated mesh/texture preview: real
//! decoded geometry (via the sidecar) and real decoded texture pixels (via
//! native Rust `texture_decode`, no sidecar round-trip needed since the
//! actual DDS bytes are already on disk once `inspect_ytd` has extracted
//! them).

use crate::error::{AppError, AppResult};
use crate::sidecar::run_sidecar;
use crate::texture_decode;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshPart {
    pub shader_name: String,
    pub vertex_count: i32,
    pub index_count: i32,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uv0: Vec<f32>,
    pub indices: Vec<i32>,
    pub dominant_bone_index: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportGeometryResult {
    pub ok: bool,
    pub error: Option<String>,
    pub drawable_name: Option<String>,
    pub lod_used: Option<String>,
    pub parts: Option<Vec<MeshPart>>,
}

#[tauri::command]
pub async fn export_geometry(
    app: tauri::AppHandle,
    path: String,
    drawable: Option<String>,
    lod: Option<String>,
) -> AppResult<ExportGeometryResult> {
    let mut args = vec!["export-geometry".to_string(), path];
    if let Some(d) = drawable {
        args.push("--drawable".to_string());
        args.push(d);
    }
    if let Some(l) = lod {
        args.push("--lod".to_string());
        args.push(l);
    }
    run_sidecar(&app, args).await
}

/// Decodes a `.dds` file (already extracted to disk by `inspect_ytd`) into a
/// PNG, returned as a base64 data-URL-ready string. Pure Rust, no sidecar
/// call - see `src-tauri/src/texture_decode.rs`.
#[tauri::command]
pub fn decode_texture_png(path: String) -> AppResult<String> {
    let bytes = std::fs::read(&path).map_err(|e| AppError(format!("Failed to read \"{path}\": {e}")))?;
    let png = texture_decode::decode_dds_to_png(&bytes)?;
    Ok(BASE64.encode(png))
}

/// Small downsampled thumbnail (for the clothing grid's cards), base64-encoded.
#[tauri::command]
pub fn decode_texture_thumbnail(path: String, max_size: u32) -> AppResult<String> {
    let bytes = std::fs::read(&path).map_err(|e| AppError(format!("Failed to read \"{path}\": {e}")))?;
    let png = texture_decode::decode_dds_to_png_thumbnail(&bytes, max_size)?;
    Ok(BASE64.encode(png))
}

/// Decodes a `.dds` file and writes the result as a real `.png` file at
/// `output_path` (Texture Viewer's "Export as PNG").
#[tauri::command]
pub fn export_texture_png(dds_path: String, output_path: String) -> AppResult<()> {
    let bytes = std::fs::read(&dds_path).map_err(|e| AppError(format!("Failed to read \"{dds_path}\": {e}")))?;
    let png = texture_decode::decode_dds_to_png(&bytes)?;
    std::fs::write(&output_path, png)
        .map_err(|e| AppError(format!("Failed to write \"{output_path}\": {e}")))?;
    Ok(())
}

/// Copies a file verbatim (Texture Viewer's "Export as DDS" — the original
/// bytes, no re-encoding).
#[tauri::command]
pub fn copy_file(source_path: String, dest_path: String) -> AppResult<()> {
    std::fs::copy(&source_path, &dest_path)
        .map_err(|e| AppError(format!("Failed to copy \"{source_path}\" to \"{dest_path}\": {e}")))?;
    Ok(())
}
