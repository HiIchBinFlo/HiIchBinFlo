//! Tauri commands that shell out to the `codewalker-bridge` sidecar for real
//! `.ydd`/`.ytd` structural decoding (see `src-tauri/src/sidecar.rs`). These
//! are additive to Phase 1's opaque asset tracking: a file that fails to
//! decode here is a genuinely corrupt/invalid RAGE resource, not a guess.

use crate::error::AppResult;
use crate::sidecar::run_sidecar;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarProbeResult {
    pub ok: bool,
    pub bridge_version: String,
    pub code_walker_core_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarTextureInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub levels: u32,
    pub format: String,
    pub data_bytes: u64,
    pub extracted_dds: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectYtdResult {
    pub ok: bool,
    pub error: Option<String>,
    pub textures: Option<Vec<SidecarTextureInfo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarBoneInfo {
    pub name: String,
    pub index: i32,
    pub parent_index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarLodInfo {
    pub level: String,
    pub present: bool,
    pub distance: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarDrawableInfo {
    pub name: String,
    pub bounding_box_min: [f32; 3],
    pub bounding_box_max: [f32; 3],
    pub bounding_center: [f32; 3],
    pub bounding_sphere_radius: f32,
    pub bone_count: i32,
    pub bones: Vec<SidecarBoneInfo>,
    pub lods: Vec<SidecarLodInfo>,
    pub total_model_count: i32,
    pub total_geometry_count: i32,
    pub total_vertex_count: i32,
    pub total_triangle_count: i32,
    pub has_embedded_texture_dictionary: bool,
    pub embedded_texture_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectYddResult {
    pub ok: bool,
    pub error: Option<String>,
    pub drawables: Option<Vec<SidecarDrawableInfo>>,
}

#[tauri::command]
pub async fn sidecar_probe(app: tauri::AppHandle) -> AppResult<SidecarProbeResult> {
    run_sidecar(&app, vec!["probe".to_string()]).await
}

#[tauri::command]
pub async fn inspect_ytd(
    app: tauri::AppHandle,
    path: String,
    extract_dir: Option<String>,
) -> AppResult<InspectYtdResult> {
    let mut args = vec!["inspect-ytd".to_string(), path];
    if let Some(dir) = extract_dir {
        args.push("--extract-dir".to_string());
        args.push(dir);
    }
    run_sidecar(&app, args).await
}

#[tauri::command]
pub async fn inspect_ydd(app: tauri::AppHandle, path: String) -> AppResult<InspectYddResult> {
    run_sidecar(&app, vec!["inspect-ydd".to_string(), path]).await
}
