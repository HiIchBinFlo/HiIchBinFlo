use crate::commands::import::assets_dir;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::fs_utils;
use crate::models::{ClothingDrawable, DlcInfo, OpenProjectResult, Project, ProjectSettings};
use chrono::Utc;
use std::path::Path;
use uuid::Uuid;

#[tauri::command]
pub fn project_create(name: String, db_path: String, settings: ProjectSettings) -> AppResult<Project> {
    if Path::new(&db_path).exists() {
        return Err(AppError(format!("A file already exists at \"{db_path}\".")));
    }
    let now = Utc::now().to_rfc3339();
    let project = Project {
        id: Uuid::new_v4().to_string(),
        name,
        db_path: db_path.clone(),
        created_at: now.clone(),
        updated_at: now,
        dlcs: Vec::new(),
        settings,
    };

    let conn = db::open(&db_path)?;
    db::write_project(&conn, &project)?;
    db::replace_dlcs(&conn, &[])?;
    std::fs::create_dir_all(assets_dir(&db_path))?;

    Ok(project)
}

#[tauri::command]
pub fn project_open(db_path: String) -> AppResult<OpenProjectResult> {
    if !Path::new(&db_path).is_file() {
        return Err(AppError(format!("Project file not found: \"{db_path}\".")));
    }
    let conn = db::open(&db_path)?;
    let mut project = db::read_project(&conn)?
        .ok_or_else(|| AppError(format!("\"{db_path}\" does not contain a valid project.")))?;
    project.db_path = db_path.clone();

    let dlcs = db::read_dlcs(&conn)?;
    let mut items = db::read_items(&conn)?;

    let assets_root = assets_dir(&db_path);
    for item in &mut items {
        if let Some(mesh) = &mut item.mesh {
            fs_utils::revalidate(mesh, &assets_root);
        }
        for tex in &mut item.textures {
            if let Some(file) = &mut tex.file {
                fs_utils::revalidate(file, &assets_root);
            }
        }
    }

    Ok(OpenProjectResult { project, items, dlcs })
}

#[tauri::command]
pub fn project_save(mut project: Project, items: Vec<ClothingDrawable>, dlcs: Vec<DlcInfo>) -> AppResult<()> {
    project.updated_at = Utc::now().to_rfc3339();
    let mut conn = db::open(&project.db_path)?;
    db::write_project(&conn, &project)?;
    db::replace_dlcs(&conn, &dlcs)?;
    db::replace_items(&mut conn, &items)?;
    Ok(())
}
