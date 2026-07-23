//! Write-back proof (Phase 4): repairs/re-normalizes a `.ydd`/`.ytd` by
//! loading it through the sidecar's CodeWalker.Core reader and
//! re-serializing it through the same library's writer, verifying the
//! output reloads with the same content before anything is written to disk.
//! See `sidecar/CodeWalkerBridge/Commands.cs::RepairYtd`/`RepairYdd` for the
//! full reasoning.

use crate::commands::import::assets_dir;
use crate::error::AppResult;
use crate::fs_utils;
use crate::models::BinaryAssetRef;
use crate::sidecar::run_sidecar;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairResult {
    pub ok: bool,
    pub error: Option<String>,
    pub output_path: Option<String>,
    pub input_bytes: u64,
    pub output_bytes: u64,
}

#[tauri::command]
pub async fn repair_ytd(app: tauri::AppHandle, input_path: String, output_path: String) -> AppResult<RepairResult> {
    run_sidecar(&app, vec!["repair-ytd".to_string(), input_path, output_path]).await
}

#[tauri::command]
pub async fn repair_ydd(app: tauri::AppHandle, input_path: String, output_path: String) -> AppResult<RepairResult> {
    run_sidecar(&app, vec!["repair-ydd".to_string(), input_path, output_path]).await
}

/// Recomputes a `BinaryAssetRef`'s size/hash from disk (used after `repair_*`
/// changes a file's bytes in place, so the project's stored hash stays accurate).
#[tauri::command]
pub fn refresh_asset_ref(db_path: String, relative_path: String) -> AppResult<BinaryAssetRef> {
    let absolute = assets_dir(&db_path).join(&relative_path);
    fs_utils::asset_ref(&absolute, &relative_path)
}
