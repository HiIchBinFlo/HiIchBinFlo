//! Batched thumbnail generation — a real gap surfaced right after Phase 6
//! shipped: importing a real ~700-item pack leaves every card showing the
//! generic placeholder icon until each item's texture is decoded
//! individually via the Inspector's on-demand "Decode" action
//! (`DecodedInfoPanel.tsx`), which is fine for one item but tedious at real
//! pack scale. This mirrors `deep_validate_project`'s bounded-concurrency
//! batching over the same sidecar decode path, but produces a thumbnail PNG
//! per item instead of just a pass/fail check.

use crate::commands::import::assets_dir;
use crate::commands::inspect::inspect_ytd;
use crate::error::AppResult;
use crate::models::ClothingDrawable;
use crate::texture_decode;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{async_runtime, AppHandle};

const MAX_CONCURRENT_SIDECAR_CALLS: usize = 8;
const THUMBNAIL_MAX_SIZE: u32 = 160;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateThumbnailsReport {
    pub generated: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
    /// item id -> base64 PNG thumbnail (no `data:` URL prefix — the
    /// frontend already has a convention for that, see `tauriApi`).
    pub thumbnails: HashMap<String, String>,
}

async fn thumbnail_for_item(
    app: AppHandle,
    item_id: String,
    tex_path: String,
    extract_dir: String,
) -> (String, Result<Option<String>, String>) {
    let result: Result<Option<String>, String> = async {
        let inspected = inspect_ytd(app, tex_path, Some(extract_dir)).await.map_err(|e| e.0)?;
        if !inspected.ok {
            return Err(inspected.error.unwrap_or_else(|| "sidecar reported a decode failure with no message".into()));
        }
        let Some(dds_path) = inspected.textures.into_iter().flatten().find_map(|t| t.extracted_dds) else {
            return Ok(None);
        };
        let bytes = std::fs::read(&dds_path).map_err(|e| format!("Failed to read extracted .dds: {e}"))?;
        let png = texture_decode::decode_dds_to_png_thumbnail(&bytes, THUMBNAIL_MAX_SIZE).map_err(|e| e.0)?;
        Ok(Some(BASE64.encode(png)))
    }
    .await;
    (item_id, result)
}

/// For every item that doesn't already have a thumbnail and has a present
/// texture file, decodes that texture through the sidecar and produces a
/// small downsampled PNG thumbnail — bounded to
/// `MAX_CONCURRENT_SIDECAR_CALLS` concurrent sidecar subprocesses at a time,
/// same reasoning as `deep_validate_project`. Returns a map the frontend
/// applies onto `ClothingDrawable.thumbnail` per item; this command never
/// touches the project's SQLite file itself.
#[tauri::command]
pub async fn generate_thumbnails(
    app: AppHandle,
    db_path: String,
    items: Vec<ClothingDrawable>,
) -> AppResult<GenerateThumbnailsReport> {
    let assets_root = assets_dir(&db_path);
    let extract_dir = assets_root.join(".preview-cache").to_string_lossy().to_string();

    let mut tasks: Vec<(String, String)> = Vec::new();
    let mut skipped = 0u32;
    for item in &items {
        if item.thumbnail.is_some() {
            continue;
        }
        let Some(tex) = item.textures.iter().find_map(|t| t.file.as_ref().filter(|f| f.present)) else {
            skipped += 1;
            continue;
        };
        tasks.push((item.id.clone(), assets_root.join(&tex.relative_path).to_string_lossy().to_string()));
    }

    let mut thumbnails = HashMap::new();
    let mut errors = Vec::new();
    for batch in tasks.chunks(MAX_CONCURRENT_SIDECAR_CALLS) {
        let mut handles = Vec::with_capacity(batch.len());
        for (item_id, tex_path) in batch {
            let app = app.clone();
            handles.push(async_runtime::spawn(thumbnail_for_item(
                app,
                item_id.clone(),
                tex_path.clone(),
                extract_dir.clone(),
            )));
        }
        for handle in handles {
            if let Ok((item_id, result)) = handle.await {
                match result {
                    Ok(Some(base64_png)) => {
                        thumbnails.insert(item_id, base64_png);
                    }
                    Ok(None) => skipped += 1,
                    Err(e) => errors.push(format!("{item_id}: {e}")),
                }
            }
        }
    }

    Ok(GenerateThumbnailsReport { generated: thumbnails.len() as u32, skipped, errors, thumbnails })
}
