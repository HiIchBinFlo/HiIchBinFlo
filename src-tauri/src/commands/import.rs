use crate::error::{AppError, AppResult};
use crate::fs_utils;
use crate::models::{
    ClothingDrawable, DlcInfo, DlcTargetGender, Gender, ImportIssue, ImportReport, ImportResult,
    ImportSourceType, ItemType, LodLevel, TextureVariant,
};
use crate::parsers::{filename as fname, fxmanifest};
use crate::slot_system::SlotTable;
use chrono::Utc;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

/// Where a project keeps the actual asset bytes it owns — a sibling
/// directory next to the `.fcstudio` SQLite file. Assets are copied in on
/// import so the project remains valid even if the original import source
/// is later moved or deleted (see docs/ARCHITECTURE.md).
pub fn assets_dir(db_path: &str) -> PathBuf {
    PathBuf::from(format!("{db_path}.assets"))
}

#[derive(Default)]
struct DrawableAccum {
    mesh: Option<(PathBuf, String)>,
    textures: BTreeMap<u32, (PathBuf, String)>,
}

#[derive(Default)]
struct ScanAccumulator {
    scanned_files: u32,
    drawables: BTreeMap<(Gender, bool, u32, u32), DrawableAccum>,
    errors: Vec<ImportIssue>,
    warnings: Vec<ImportIssue>,
}

fn classify_file(root: &Path, path: &Path, acc: &mut ScanAccumulator) {
    acc.scanned_files += 1;
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return,
    };
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    match ext.as_str() {
        "ydd" => {
            let Some(parsed) = fname::parse_mesh_filename(file_name) else {
                acc.warnings.push(ImportIssue {
                    file: relative,
                    message: "Mesh file does not follow the standard <component>_<id>_<r|u>.ydd naming convention; skipped.".into(),
                });
                return;
            };
            let component_id = if parsed.is_prop {
                fname::prop_id_for_key(&parsed.component_key)
            } else {
                fname::component_id_for_key(&parsed.component_key)
            };
            let Some(component_id) = component_id else {
                acc.warnings.push(ImportIssue {
                    file: relative,
                    message: format!("Unrecognized component/prop key \"{}\".", parsed.component_key),
                });
                return;
            };
            let gender = fname::detect_gender_from_path(&relative).unwrap_or_else(|| {
                acc.warnings.push(ImportIssue {
                    file: relative.clone(),
                    message: "Could not detect gender from path; defaulted to male.".into(),
                });
                Gender::Male
            });
            let key = (gender, parsed.is_prop, component_id, parsed.drawable_id);
            let entry = acc.drawables.entry(key).or_default();
            if entry.mesh.is_some() {
                acc.warnings.push(ImportIssue {
                    file: relative.clone(),
                    message: "Duplicate mesh file for the same drawable id; keeping the first one found.".into(),
                });
            } else {
                entry.mesh = Some((path.to_path_buf(), relative));
            }
        }
        "ytd" => {
            let Some(parsed) = fname::parse_texture_filename(file_name) else {
                acc.warnings.push(ImportIssue {
                    file: relative,
                    message: "Texture file does not follow the standard <component>_diff_<id>_<tex>_<suffix>_<race>.ytd naming convention; skipped.".into(),
                });
                return;
            };
            let component_id = if parsed.is_prop {
                fname::prop_id_for_key(&parsed.component_key)
            } else {
                fname::component_id_for_key(&parsed.component_key)
            };
            let Some(component_id) = component_id else {
                acc.warnings.push(ImportIssue {
                    file: relative,
                    message: format!("Unrecognized component/prop key \"{}\".", parsed.component_key),
                });
                return;
            };
            let gender = fname::detect_gender_from_path(&relative).unwrap_or(Gender::Male);
            let key = (gender, parsed.is_prop, component_id, parsed.drawable_id);
            let entry = acc.drawables.entry(key).or_default();
            match entry.textures.entry(parsed.texture_id) {
                std::collections::btree_map::Entry::Vacant(slot) => {
                    slot.insert((path.to_path_buf(), relative));
                }
                std::collections::btree_map::Entry::Occupied(_) => {
                    acc.errors.push(ImportIssue {
                        file: relative.clone(),
                        message: format!(
                            "Duplicate texture id {} for the same drawable; source pack is ambiguous.",
                            parsed.texture_id
                        ),
                    });
                }
            }
        }
        "ymt" => {
            // Real .ymt is RSC7-compressed binary (RAGE resource format). It is
            // tracked as an opaque asset and passed through untouched; it is not
            // decoded in Phase 1 (see docs/FILE_FORMATS.md).
            acc.warnings.push(ImportIssue {
                file: relative,
                message: "Binary .ymt metadata detected; carried through untouched (not decoded).".into(),
            });
        }
        "meta" | "xml" => {
            if file_name.eq_ignore_ascii_case("fxmanifest.lua") {
                return; // handled separately
            }
            match fs::read_to_string(path) {
                Ok(text) => {
                    if let Err(err) = crate::parsers::meta_xml::flatten(&text) {
                        acc.warnings.push(ImportIssue {
                            file: relative,
                            message: format!("Could not parse metadata XML structurally: {err}"),
                        });
                    }
                    // Structural contents are captured for future schema-aware mapping
                    // (Phase 2); the raw file itself is preserved for export as-is.
                }
                Err(err) => acc.errors.push(ImportIssue {
                    file: relative,
                    message: format!("Could not read file: {err}"),
                }),
            }
        }
        _ => {}
    }
}

/// Finds every subtree that looks like an independent FiveM resource/DLC
/// (contains `fxmanifest.lua` or `dlc.meta`). Falls back to treating the
/// whole root as a single implicit resource when none is found.
fn find_resource_roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if name.eq_ignore_ascii_case("fxmanifest.lua") || name.eq_ignore_ascii_case("dlc.meta") {
            if let Some(parent) = entry.path().parent() {
                roots.push(parent.to_path_buf());
            }
        }
    }
    roots.sort();
    roots.dedup();
    if roots.is_empty() {
        roots.push(root.to_path_buf());
    }
    roots
}

fn resource_name_for(resource_root: &Path) -> String {
    let manifest_path = resource_root.join("fxmanifest.lua");
    if let Ok(text) = fs::read_to_string(&manifest_path) {
        let manifest = fxmanifest::parse(&text);
        if let Some(name) = manifest.name {
            if !name.trim().is_empty() {
                return name;
            }
        }
    }
    resource_root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "imported_pack".to_string())
}

fn copy_into_assets(
    file: &(PathBuf, String),
    assets_root: &Path,
    dlc_resource_name: &str,
) -> AppResult<crate::models::BinaryAssetRef> {
    let (source_path, _original_relative) = file;
    let file_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let dest_relative = format!("{dlc_resource_name}/stream/{file_name}");
    let dest_absolute = assets_root.join(&dest_relative);
    if let Some(parent) = dest_absolute.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source_path, &dest_absolute)?;
    fs_utils::asset_ref(&dest_absolute, &dest_relative)
}

fn scan_resource_root(
    resource_root: &Path,
    assets_root: &Path,
    acc_totals: &mut ScanAccumulator,
    items: &mut Vec<ClothingDrawable>,
    dlcs: &mut Vec<DlcInfo>,
    slot_table: &mut SlotTable,
) -> AppResult<()> {
    let mut acc = ScanAccumulator::default();
    for entry in WalkDir::new(resource_root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            classify_file(resource_root, entry.path(), &mut acc);
        }
    }

    let resource_name = resource_name_for(resource_root);
    let dlc_id = Uuid::new_v4().to_string();
    let has_any_drawable = !acc.drawables.is_empty();
    if has_any_drawable {
        dlcs.push(DlcInfo {
            id: dlc_id.clone(),
            name: resource_name.clone(),
            resource_name: resource_name.clone(),
            target_gender: DlcTargetGender::Unisex,
        });
    }

    let now = Utc::now().to_rfc3339();
    for ((gender, is_prop, component_id, drawable_id), accum) in acc.drawables {
        let Some(mesh_file) = accum.mesh.as_ref() else {
            for (_, (_, rel)) in accum.textures {
                acc.warnings.push(ImportIssue {
                    file: rel,
                    message: "Texture has no matching mesh (.ydd); item was not created.".into(),
                });
            }
            continue;
        };

        let item_id = Uuid::new_v4().to_string();
        let key = SlotTable::key(
            gender.as_str(),
            if is_prop { "prop" } else { "component" },
            component_id,
        );
        if let Err(err) = slot_table.reserve_exact(&key, drawable_id, &item_id) {
            acc.errors.push(ImportIssue {
                file: mesh_file.1.clone(),
                message: format!(
                    "Drawable id {drawable_id} conflicts with an already-imported item in the same slot track: {err}"
                ),
            });
            continue;
        }

        let mesh_asset = copy_into_assets(mesh_file, assets_root, &resource_name)?;
        let mut textures = Vec::new();
        for (texture_id, tex_file) in &accum.textures {
            let asset = copy_into_assets(tex_file, assets_root, &resource_name)?;
            textures.push(TextureVariant {
                texture_id: *texture_id,
                name: format!("Variant {texture_id}"),
                file: Some(asset),
            });
        }

        let label = if is_prop {
            fname::PED_PROP_KEYS
                .iter()
                .find(|(_, id)| *id == component_id)
                .map(|(k, _)| *k)
                .unwrap_or("prop")
        } else {
            fname::PED_COMPONENT_KEYS
                .iter()
                .find(|(_, id)| *id == component_id)
                .map(|(k, _)| *k)
                .unwrap_or("component")
        };

        items.push(ClothingDrawable {
            id: item_id,
            drawable_id,
            item_type: if is_prop { ItemType::Prop } else { ItemType::Component },
            component_id,
            gender,
            dlc: dlc_id.clone(),
            name: format!("{label} #{drawable_id}"),
            category: label.to_string(),
            description: String::new(),
            tags: Vec::new(),
            lod: LodLevel::High,
            mesh: Some(mesh_asset),
            textures,
            hashes: Default::default(),
            metadata: Default::default(),
            thumbnail: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    acc_totals.scanned_files += acc.scanned_files;
    acc_totals.errors.extend(acc.errors);
    acc_totals.warnings.extend(acc.warnings);
    Ok(())
}

fn build_report(
    source_type: ImportSourceType,
    source_path: &str,
    acc: &ScanAccumulator,
    items: &[ClothingDrawable],
    dlcs: &[DlcInfo],
) -> ImportReport {
    let drawables_found = items.len() as u32;
    let components_found = items.iter().filter(|i| i.item_type == ItemType::Component).count() as u32;
    let props_found = items.iter().filter(|i| i.item_type == ItemType::Prop).count() as u32;
    let textures_found = items.iter().map(|i| i.textures.len() as u32).sum();
    let mut genders: Vec<Gender> = items.iter().map(|i| i.gender).collect();
    genders.sort_by_key(|g| g.as_str());
    genders.dedup_by_key(|g| g.as_str());

    ImportReport {
        source_type,
        source_path: source_path.to_string(),
        scanned_files: acc.scanned_files,
        drawables_found,
        textures_found,
        components_found,
        props_found,
        dlcs_detected: dlcs.iter().map(|d| d.resource_name.clone()).collect(),
        genders_detected: genders,
        missing_files: Vec::new(),
        errors: acc.errors.clone(),
        warnings: acc.warnings.clone(),
    }
}

fn scan_directory_tree(
    root: &Path,
    assets_root: &Path,
    source_type: ImportSourceType,
    source_path_label: &str,
) -> AppResult<ImportResult> {
    let mut totals = ScanAccumulator::default();
    let mut items = Vec::new();
    let mut dlcs = Vec::new();
    let mut slot_table = SlotTable::new();

    for resource_root in find_resource_roots(root) {
        scan_resource_root(
            &resource_root,
            assets_root,
            &mut totals,
            &mut items,
            &mut dlcs,
            &mut slot_table,
        )?;
    }

    let report = build_report(source_type, source_path_label, &totals, &items, &dlcs);
    Ok(ImportResult { report, items, dlcs })
}

fn scan_loose_files(paths: &[PathBuf], assets_root: &Path) -> AppResult<ImportResult> {
    let mut acc = ScanAccumulator::default();
    let mut drawables: BTreeMap<(Gender, bool, u32, u32), DrawableAccum> = BTreeMap::new();

    // Treat every selected file as if it lived directly under a single virtual root,
    // so relative-path-based gender detection still works when the user picks files
    // from a folder that itself encodes gender (e.g. .../female/uppr_000_u.ydd).
    for path in paths {
        let relative = path.to_string_lossy().replace('\\', "/");
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        acc.scanned_files += 1;
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        match ext.as_str() {
            "ydd" => {
                if let Some(parsed) = fname::parse_mesh_filename(file_name) {
                    let component_id = if parsed.is_prop {
                        fname::prop_id_for_key(&parsed.component_key)
                    } else {
                        fname::component_id_for_key(&parsed.component_key)
                    };
                    if let Some(component_id) = component_id {
                        let gender = fname::detect_gender_from_path(&relative).unwrap_or(Gender::Male);
                        let key = (gender, parsed.is_prop, component_id, parsed.drawable_id);
                        drawables.entry(key).or_default().mesh = Some((path.clone(), relative.clone()));
                    }
                } else {
                    acc.warnings.push(ImportIssue {
                        file: relative,
                        message: "Mesh file does not follow the standard naming convention; skipped.".into(),
                    });
                }
            }
            "ytd" => {
                if let Some(parsed) = fname::parse_texture_filename(file_name) {
                    let component_id = if parsed.is_prop {
                        fname::prop_id_for_key(&parsed.component_key)
                    } else {
                        fname::component_id_for_key(&parsed.component_key)
                    };
                    if let Some(component_id) = component_id {
                        let gender = fname::detect_gender_from_path(&relative).unwrap_or(Gender::Male);
                        let key = (gender, parsed.is_prop, component_id, parsed.drawable_id);
                        drawables
                            .entry(key)
                            .or_default()
                            .textures
                            .insert(parsed.texture_id, (path.clone(), relative.clone()));
                    }
                } else {
                    acc.warnings.push(ImportIssue {
                        file: relative,
                        message: "Texture file does not follow the standard naming convention; skipped.".into(),
                    });
                }
            }
            _ => acc.warnings.push(ImportIssue {
                file: relative,
                message: "File type not recognized for individual-file import; skipped.".into(),
            }),
        }
    }

    let resource_name = "imported_files".to_string();
    let dlc_id = Uuid::new_v4().to_string();
    let mut dlcs = Vec::new();
    let mut items = Vec::new();
    let mut slot_table = SlotTable::new();
    let now = Utc::now().to_rfc3339();

    if !drawables.is_empty() {
        dlcs.push(DlcInfo {
            id: dlc_id.clone(),
            name: "Imported Files".to_string(),
            resource_name: resource_name.clone(),
            target_gender: DlcTargetGender::Unisex,
        });
    }

    for ((gender, is_prop, component_id, drawable_id), accum) in drawables {
        let Some(mesh_file) = accum.mesh.as_ref() else { continue };
        let item_id = Uuid::new_v4().to_string();
        let key = SlotTable::key(gender.as_str(), if is_prop { "prop" } else { "component" }, component_id);
        if let Err(err) = slot_table.reserve_exact(&key, drawable_id, &item_id) {
            acc.errors.push(ImportIssue {
                file: mesh_file.1.clone(),
                message: format!("Drawable id conflict: {err}"),
            });
            continue;
        }
        let mesh_asset = copy_into_assets(mesh_file, assets_root, &resource_name)?;
        let mut textures = Vec::new();
        for (texture_id, tex_file) in &accum.textures {
            let asset = copy_into_assets(tex_file, assets_root, &resource_name)?;
            textures.push(TextureVariant {
                texture_id: *texture_id,
                name: format!("Variant {texture_id}"),
                file: Some(asset),
            });
        }
        items.push(ClothingDrawable {
            id: item_id,
            drawable_id,
            item_type: if is_prop { ItemType::Prop } else { ItemType::Component },
            component_id,
            gender,
            dlc: dlc_id.clone(),
            name: format!("Item #{drawable_id}"),
            category: String::new(),
            description: String::new(),
            tags: Vec::new(),
            lod: LodLevel::High,
            mesh: Some(mesh_asset),
            textures,
            hashes: Default::default(),
            metadata: Default::default(),
            thumbnail: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    let report = build_report(ImportSourceType::Files, "(individual files)", &acc, &items, &dlcs);
    Ok(ImportResult { report, items, dlcs })
}

fn extract_zip(zip_path: &Path, dest: &Path) -> AppResult<()> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue; // reject entries with unsafe/absolute paths (zip-slip protection)
        };
        let out_path = dest.join(enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out_file = fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out_file)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn import_source(
    source_type: ImportSourceType,
    source_path: String,
    db_path: String,
) -> AppResult<ImportResult> {
    let assets_root = assets_dir(&db_path);
    fs::create_dir_all(&assets_root)?;

    match source_type {
        ImportSourceType::Resource | ImportSourceType::Folder => {
            let root = PathBuf::from(&source_path);
            if !root.is_dir() {
                return Err(AppError(format!("\"{source_path}\" is not a directory.")));
            }
            scan_directory_tree(&root, &assets_root, source_type, &source_path)
        }
        ImportSourceType::Zip => {
            let zip_path = PathBuf::from(&source_path);
            let temp_dir = std::env::temp_dir().join(format!("fcstudio-import-{}", Uuid::new_v4()));
            fs::create_dir_all(&temp_dir)?;
            extract_zip(&zip_path, &temp_dir)?;
            let result = scan_directory_tree(&temp_dir, &assets_root, source_type, &source_path);
            let _ = fs::remove_dir_all(&temp_dir);
            result
        }
        ImportSourceType::Files => {
            let paths: Vec<PathBuf> = source_path.split('|').map(PathBuf::from).collect();
            scan_loose_files(&paths, &assets_root)
        }
    }
}
