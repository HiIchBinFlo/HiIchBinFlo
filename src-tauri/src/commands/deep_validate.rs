//! Batched "deep validate everything" — Phase 5 addition, deferred explicitly
//! in Phase 2 (see docs/ROADMAP.md). The Inspector's per-item "Decode" action
//! (`inspect_ytd`/`inspect_ydd`) stays on-demand so import itself stays fast
//! for 20k+-file packs (see `commands::inspect`'s module doc); this command
//! is the opt-in complement: actually decode every mesh/texture file in the
//! project through the same real sidecar path, so a structurally-corrupt
//! `.ydd`/`.ytd` is caught before it ships, not discovered only when someone
//! happens to click that one item in the Inspector.
//!
//! Bounded concurrency, not "spawn every file at once": each decode is a
//! subprocess invocation of the .NET sidecar, and a project can have
//! thousands of items — an unbounded burst of subprocess spawns would be
//! its own performance problem. `MAX_CONCURRENT_SIDECAR_CALLS` caps how many
//! sidecar processes run at once, batch by batch.

use crate::commands::import::assets_dir;
use crate::commands::inspect::{inspect_ydd, inspect_ytd};
use crate::error::AppResult;
use crate::models::{ClothingDrawable, ValidationIssue, ValidationSeverity};
use serde::{Deserialize, Serialize};
use tauri::{async_runtime, AppHandle};
use uuid::Uuid;

const MAX_CONCURRENT_SIDECAR_CALLS: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepValidationReport {
    pub meshes_checked: u32,
    pub textures_checked: u32,
    pub issues: Vec<ValidationIssue>,
}

fn issue(item_id: &str, file: &str, message: String) -> ValidationIssue {
    ValidationIssue {
        id: Uuid::new_v4().to_string(),
        severity: ValidationSeverity::Error,
        code: "DECODE_FAILED".to_string(),
        message,
        item_id: Some(item_id.to_string()),
        file: Some(file.to_string()),
    }
}

enum CheckTask {
    Mesh { item_id: String, file_name: String, abs_path: String },
    Texture { item_id: String, file_name: String, abs_path: String },
}

async fn run_check(app: AppHandle, task: CheckTask) -> Option<ValidationIssue> {
    match task {
        CheckTask::Mesh { item_id, file_name, abs_path } => match inspect_ydd(app, abs_path).await {
            Ok(result) if result.ok => None,
            Ok(result) => Some(issue(
                &item_id,
                &file_name,
                result.error.unwrap_or_else(|| "sidecar reported a decode failure with no message".into()),
            )),
            Err(err) => Some(issue(&item_id, &file_name, err.0)),
        },
        CheckTask::Texture { item_id, file_name, abs_path } => match inspect_ytd(app, abs_path, None).await {
            Ok(result) if result.ok => None,
            Ok(result) => Some(issue(
                &item_id,
                &file_name,
                result.error.unwrap_or_else(|| "sidecar reported a decode failure with no message".into()),
            )),
            Err(err) => Some(issue(&item_id, &file_name, err.0)),
        },
    }
}

#[tauri::command]
pub async fn deep_validate_project(
    app: AppHandle,
    db_path: String,
    items: Vec<ClothingDrawable>,
) -> AppResult<DeepValidationReport> {
    let assets_root = assets_dir(&db_path);
    let mut tasks = Vec::new();
    let mut meshes_checked = 0u32;
    let mut textures_checked = 0u32;

    for item in &items {
        if let Some(mesh) = &item.mesh {
            if mesh.present {
                tasks.push(CheckTask::Mesh {
                    item_id: item.id.clone(),
                    file_name: mesh.file_name.clone(),
                    abs_path: assets_root.join(&mesh.relative_path).to_string_lossy().to_string(),
                });
                meshes_checked += 1;
            }
        }
        for tex in &item.textures {
            if let Some(file) = &tex.file {
                if file.present {
                    tasks.push(CheckTask::Texture {
                        item_id: item.id.clone(),
                        file_name: file.file_name.clone(),
                        abs_path: assets_root.join(&file.relative_path).to_string_lossy().to_string(),
                    });
                    textures_checked += 1;
                }
            }
        }
    }

    let mut issues = Vec::new();
    for batch in tasks.chunks(MAX_CONCURRENT_SIDECAR_CALLS) {
        let mut handles = Vec::with_capacity(batch.len());
        for task in batch {
            let app = app.clone();
            let task = match task {
                CheckTask::Mesh { item_id, file_name, abs_path } => CheckTask::Mesh {
                    item_id: item_id.clone(),
                    file_name: file_name.clone(),
                    abs_path: abs_path.clone(),
                },
                CheckTask::Texture { item_id, file_name, abs_path } => CheckTask::Texture {
                    item_id: item_id.clone(),
                    file_name: file_name.clone(),
                    abs_path: abs_path.clone(),
                },
            };
            handles.push(async_runtime::spawn(run_check(app, task)));
        }
        for handle in handles {
            if let Ok(Some(found)) = handle.await {
                issues.push(found);
            }
        }
    }

    Ok(DeepValidationReport { meshes_checked, textures_checked, issues })
}
