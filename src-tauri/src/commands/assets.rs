use crate::commands::import::assets_dir;
use crate::error::{AppError, AppResult};
use crate::fs_utils;
use crate::models::BinaryAssetRef;
use std::fs;
use std::path::PathBuf;

/// Copies a user-picked file (via the native file dialog) into the
/// project's asset storage under `<dlcResourceName>/stream/<filename>`.
/// Used by the Inspector's "Replace" and "Add file" actions.
#[tauri::command]
pub fn import_asset_file(db_path: String, dlc_resource_name: String, source_path: String) -> AppResult<BinaryAssetRef> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err(AppError(format!("\"{source_path}\" is not a file.")));
    }
    let file_name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| AppError("Selected path has no file name.".into()))?;

    let assets_root = assets_dir(&db_path);
    let dest_relative = format!("{dlc_resource_name}/stream/{file_name}");
    let dest_absolute = assets_root.join(&dest_relative);
    if let Some(parent) = dest_absolute.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&source, &dest_absolute)?;
    fs_utils::asset_ref(&dest_absolute, &dest_relative)
}

/// Copies an already-imported asset to a new, deduplicated filename in the
/// same directory (e.g. `uppr_000_u.ydd` -> `uppr_000_u_copy.ydd`, then
/// `_copy2`, `_copy3`, ...). Used by the Inspector's "Duplicate file" action.
#[tauri::command]
pub fn duplicate_asset_file(db_path: String, relative_path: String) -> AppResult<BinaryAssetRef> {
    let assets_root = assets_dir(&db_path);
    let source = assets_root.join(&relative_path);
    if !source.is_file() {
        return Err(AppError(format!("Asset \"{relative_path}\" does not exist in project storage.")));
    }

    let parent_relative = PathBuf::from(&relative_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let extension = source.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();

    let mut candidate_relative;
    let mut suffix = "copy".to_string();
    let mut attempt = 1;
    loop {
        let candidate_name = format!("{stem}_{suffix}.{extension}");
        candidate_relative = parent_relative.join(&candidate_name).to_string_lossy().replace('\\', "/");
        let candidate_absolute = assets_root.join(&candidate_relative);
        if !candidate_absolute.is_file() {
            break;
        }
        attempt += 1;
        suffix = format!("copy{attempt}");
    }

    let dest_absolute = assets_root.join(&candidate_relative);
    fs::copy(&source, &dest_absolute)?;
    fs_utils::asset_ref(&dest_absolute, &candidate_relative)
}
