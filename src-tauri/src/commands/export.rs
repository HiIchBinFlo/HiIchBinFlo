use crate::commands::import::assets_dir;
use crate::commands::validate::validate_project;
use crate::error::{AppError, AppResult};
use crate::models::{ClothingDrawable, DlcInfo, ExportFormat, ExportResult, Project, ValidationSeverity};
use crate::parsers::fxmanifest;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const DLC_META_SKELETON: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<CDLCData>
  <dataFiles />
  <contentChangeSets />
  <contentChangeSetGroups />
  <patchFiles />
</CDLCData>
"#;

const CONTENT_XML_SKELETON: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<CDataFileMgr__ContentsOfDataFileXml>
  <disabledFiles />
  <includedXmlFiles />
  <includedDataFiles />
  <dataFiles />
  <contentChangeSets />
  <patchFiles />
</CDataFileMgr__ContentsOfDataFileXml>
"#;

/// `BinaryAssetRef.relative_path` is relative to the *project's assets
/// directory*; this resolves the absolute source path there and copies the
/// file to `dest`.
fn copy_asset_from(assets_root: &Path, asset: &crate::models::BinaryAssetRef, dest: &Path) -> AppResult<()> {
    let source = assets_root.join(&asset.relative_path);
    if !source.is_file() {
        return Err(AppError(format!(
            "Asset \"{}\" is missing from the project's asset storage ({}).",
            asset.file_name,
            source.display()
        )));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&source, dest)?;
    Ok(())
}

fn zip_directory(source_dir: &Path, zip_path: &Path) -> AppResult<()> {
    let file = fs::File::create(zip_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for entry in walkdir::WalkDir::new(source_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let relative = path.strip_prefix(source_dir).unwrap();
        if relative.as_os_str().is_empty() {
            continue;
        }
        let name = relative.to_string_lossy().replace('\\', "/");
        if path.is_dir() {
            zip.add_directory(format!("{name}/"), options)?;
        } else {
            zip.start_file(name, options)?;
            let bytes = fs::read(path)?;
            std::io::Write::write_all(&mut zip, &bytes)?;
        }
    }
    zip.finish()?;
    Ok(())
}

#[tauri::command]
pub fn export_project(
    project: Project,
    items: Vec<ClothingDrawable>,
    dlcs: Vec<DlcInfo>,
    format: ExportFormat,
    output_path: String,
) -> AppResult<ExportResult> {
    let issues = validate_project(&items, &dlcs);
    if issues.iter().any(|i| i.severity == ValidationSeverity::Error) {
        return Err(AppError(
            "Project has blocking validation errors; fix them before exporting.".into(),
        ));
    }

    let assets_root = assets_dir(&project.db_path);
    let dlc_by_id: HashMap<&str, &DlcInfo> = dlcs.iter().map(|d| (d.id.as_str(), d)).collect();

    let mut items_by_dlc: HashMap<String, Vec<&ClothingDrawable>> = HashMap::new();
    for item in &items {
        items_by_dlc.entry(item.dlc.clone()).or_default().push(item);
    }

    // Resolve every referenced asset's absolute source path up front so a
    // missing file fails loudly instead of producing a silently-broken export.
    for item in &items {
        if let Some(mesh) = &item.mesh {
            let source = assets_root.join(&mesh.relative_path);
            if !source.is_file() {
                return Err(AppError(format!(
                    "Mesh \"{}\" for \"{}\" is missing from project storage.",
                    mesh.file_name, item.name
                )));
            }
        }
    }

    let staging_root: PathBuf = if format == ExportFormat::Zip {
        std::env::temp_dir().join(format!("fcstudio-export-{}", uuid::Uuid::new_v4()))
    } else {
        PathBuf::from(&output_path)
    };
    fs::create_dir_all(&staging_root)?;

    let mut total_files_written = 0u32;
    let mut all_asset_dests: Vec<(crate::models::BinaryAssetRef, PathBuf)> = Vec::new();

    match format {
        ExportFormat::Files => {
            let flat_dir = &staging_root;
            for item in &items {
                if let Some(mesh) = &item.mesh {
                    all_asset_dests.push((mesh.clone(), flat_dir.join(&mesh.file_name)));
                }
                for tex in &item.textures {
                    if let Some(file) = &tex.file {
                        all_asset_dests.push((file.clone(), flat_dir.join(&file.file_name)));
                    }
                }
            }
        }
        ExportFormat::Resource | ExportFormat::Zip | ExportFormat::Dlc => {
            for (dlc_id, dlc_items) in &items_by_dlc {
                let resource_name = dlc_by_id
                    .get(dlc_id.as_str())
                    .map(|d| d.resource_name.clone())
                    .unwrap_or_else(|| "clothing_pack".to_string());
                let resource_root = staging_root.join(&resource_name);

                for item in dlc_items {
                    if let Some(mesh) = &item.mesh {
                        all_asset_dests
                            .push((mesh.clone(), resource_root.join("stream").join(&mesh.file_name)));
                    }
                    for tex in &item.textures {
                        if let Some(file) = &tex.file {
                            all_asset_dests
                                .push((file.clone(), resource_root.join("stream").join(&file.file_name)));
                        }
                    }
                }

                let stream_files: Vec<String> = dlc_items
                    .iter()
                    .flat_map(|item| {
                        let mut names = Vec::new();
                        if let Some(mesh) = &item.mesh {
                            names.push(format!("stream/{}", mesh.file_name));
                        }
                        for tex in &item.textures {
                            if let Some(file) = &tex.file {
                                names.push(format!("stream/{}", file.file_name));
                            }
                        }
                        names
                    })
                    .collect();

                let dlc_meta_ref = if format == ExportFormat::Dlc { Some("dlc.meta") } else { None };
                let manifest = fxmanifest::generate(
                    &resource_name,
                    &format!("Exported by FiveM Clothing Studio ({} items)", dlc_items.len()),
                    &stream_files,
                    dlc_meta_ref,
                );
                fs::create_dir_all(&resource_root)?;
                fs::write(resource_root.join("fxmanifest.lua"), manifest)?;
                total_files_written += 1;

                if format == ExportFormat::Dlc {
                    fs::write(resource_root.join("dlc.meta"), DLC_META_SKELETON)?;
                    fs::write(resource_root.join("content.xml"), CONTENT_XML_SKELETON)?;
                    total_files_written += 2;
                }
            }
        }
    }

    for (asset, dest) in &all_asset_dests {
        copy_asset_from(&assets_root, asset, dest)?;
        total_files_written += 1;
    }

    let final_output_path = if format == ExportFormat::Zip {
        let zip_path = PathBuf::from(&output_path);
        zip_directory(&staging_root, &zip_path)?;
        let _ = fs::remove_dir_all(&staging_root);
        zip_path
    } else {
        staging_root
    };

    Ok(ExportResult {
        output_path: final_output_path.to_string_lossy().to_string(),
        files_written: total_files_written,
        issues,
    })
}
