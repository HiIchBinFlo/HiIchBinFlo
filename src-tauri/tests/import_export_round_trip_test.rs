//! Full lifecycle integration test: import a real pack from disk, then
//! export it back out in every format, and check the exported files are
//! actually there with sane content — not just that `export_project`
//! returned `Ok`. `export_project` (`src-tauri/src/commands/export.rs`) had
//! zero tests of any kind before this file; import and export were each
//! only ever exercised in isolation (or not at all), never chained the way
//! the app actually uses them (import a pack, edit, export it back out).

use fivem_clothing_studio_lib::commands::export::export_project;
use fivem_clothing_studio_lib::commands::import::import_source;
use fivem_clothing_studio_lib::models::{
    ExportFormat, Framework, ImportSourceType, Project, ProjectSettings,
};
use std::fs;
use std::path::Path;
use tempfile::tempdir;

fn write_dummy(path: &Path, contents: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, contents).unwrap();
}

fn build_source_pack(root: &Path) {
    write_dummy(
        &root.join("fxmanifest.lua"),
        b"fx_version 'cerulean'\ngame 'gta5'\nname 'roundtrip_pack'\n",
    );
    write_dummy(&root.join("stream/uppr_000_u.ydd"), b"mesh-uppr-0");
    write_dummy(&root.join("stream/uppr_diff_000_000_a_uni.ytd"), b"tex-uppr-0-0");
    write_dummy(&root.join("stream/lowr_001_u.ydd"), b"mesh-lowr-1");
    write_dummy(&root.join("stream/lowr_diff_001_000_a_uni.ytd"), b"tex-lowr-1-0");
}

fn project_for(db_path: &str, dlcs: Vec<fivem_clothing_studio_lib::models::DlcInfo>) -> Project {
    Project {
        id: "test-project".into(),
        name: "Round Trip Pack".into(),
        db_path: db_path.to_string(),
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        dlcs,
        settings: ProjectSettings {
            resource_name: "roundtrip_pack".into(),
            framework: Framework::Standalone,
            fx_server_min_version: "5848".into(),
        },
    }
}

#[test]
fn imports_then_exports_as_a_resource_folder_with_every_asset_present() {
    let src = tempdir().unwrap();
    build_source_pack(src.path());
    let db_dir = tempdir().unwrap();
    let db_path = db_dir.path().join("project.fcstudio").to_string_lossy().to_string();

    let imported = import_source(ImportSourceType::Folder, src.path().to_string_lossy().to_string(), db_path.clone())
        .expect("import should succeed");
    assert_eq!(imported.items.len(), 2);

    let project = project_for(&db_path, imported.dlcs.clone());
    let out_dir = tempdir().unwrap();
    let output_path = out_dir.path().join("export").to_string_lossy().to_string();

    let result = export_project(
        project,
        imported.items.clone(),
        imported.dlcs.clone(),
        ExportFormat::Resource,
        output_path.clone(),
    )
    .expect("export should succeed for a validly-imported project");

    assert!(result.files_written > 0);
    assert!(result.issues.is_empty(), "unexpected validation issues: {:?}", result.issues);

    let resource_dir = Path::new(&output_path).join("roundtrip_pack");
    assert!(resource_dir.join("fxmanifest.lua").is_file());
    let manifest = fs::read_to_string(resource_dir.join("fxmanifest.lua")).unwrap();
    assert!(manifest.contains("stream/uppr_000_u.ydd"));
    assert!(manifest.contains("stream/lowr_001_u.ydd"));

    for item in &imported.items {
        let mesh = item.mesh.as_ref().unwrap();
        let exported_mesh = resource_dir.join("stream").join(&mesh.file_name);
        assert!(exported_mesh.is_file(), "{} missing from export", exported_mesh.display());
        assert_eq!(fs::read(&exported_mesh).unwrap().len() as u64, mesh.size_bytes);
    }
}

#[test]
fn imports_then_exports_as_a_zip() {
    let src = tempdir().unwrap();
    build_source_pack(src.path());
    let db_dir = tempdir().unwrap();
    let db_path = db_dir.path().join("project.fcstudio").to_string_lossy().to_string();

    let imported = import_source(ImportSourceType::Folder, src.path().to_string_lossy().to_string(), db_path.clone())
        .expect("import should succeed");

    let project = project_for(&db_path, imported.dlcs.clone());
    let out_dir = tempdir().unwrap();
    let zip_path = out_dir.path().join("export.zip").to_string_lossy().to_string();

    let result = export_project(
        project,
        imported.items.clone(),
        imported.dlcs.clone(),
        ExportFormat::Zip,
        zip_path.clone(),
    )
    .expect("zip export should succeed");

    assert!(Path::new(&zip_path).is_file());
    let file = fs::File::open(&zip_path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect();
    assert!(names.iter().any(|n| n.ends_with("fxmanifest.lua")));
    assert!(names.iter().any(|n| n.ends_with("uppr_000_u.ydd")));
    assert!(result.files_written > 0);
}

#[test]
fn export_of_a_project_with_a_missing_asset_fails_loudly_instead_of_writing_a_broken_pack() {
    let src = tempdir().unwrap();
    build_source_pack(src.path());
    let db_dir = tempdir().unwrap();
    let db_path = db_dir.path().join("project.fcstudio").to_string_lossy().to_string();

    let imported = import_source(ImportSourceType::Folder, src.path().to_string_lossy().to_string(), db_path.clone())
        .expect("import should succeed");

    // Simulate the mesh file having disappeared from project storage after
    // import (e.g. the user deleted it out-of-band).
    let mesh_asset = imported.items[0].mesh.as_ref().unwrap();
    let assets_root = fivem_clothing_studio_lib::commands::import::assets_dir(&db_path);
    fs::remove_file(assets_root.join(&mesh_asset.relative_path)).unwrap();

    let project = project_for(&db_path, imported.dlcs.clone());
    let out_dir = tempdir().unwrap();
    let output_path = out_dir.path().join("export").to_string_lossy().to_string();

    let result = export_project(project, imported.items, imported.dlcs, ExportFormat::Resource, output_path);
    assert!(result.is_err(), "export should refuse to silently produce a pack missing an asset");
}
