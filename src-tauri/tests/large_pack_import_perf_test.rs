//! Scale test: builds a synthetic pack shaped like a large real-world
//! clothing resource (thousands of drawables spread across every component
//! and prop track, both genders) and imports it end to end through
//! `import_source` — the same entry point the UI calls. Two things this
//! guards against that no unit test can:
//!
//! 1. Correctness at scale: nothing in the classify -> slot-reserve -> copy
//!    pipeline assumes a handful of files; this exercises it against
//!    thousands, across every component/prop track's id space at once.
//! 2. A gross performance regression in the per-file copy+SHA-256 step,
//!    which was parallelized with rayon (see `commands::import::
//!    copy_pending_items_parallel`) specifically because it's the most
//!    likely first bottleneck for the 20k+-file packs this project targets
//!    (docs/ARCHITECTURE.md's Performance posture section). The wall-clock
//!    assertion below is a deliberately generous ceiling — a regression
//!    guard against "someone made this accidentally quadratic," not a tight
//!    benchmark that would be flaky across CI hardware.

use fivem_clothing_studio_lib::commands::import::import_source;
use fivem_clothing_studio_lib::models::ImportSourceType;
use fivem_clothing_studio_lib::parsers::filename::{PED_COMPONENT_KEYS, PED_PROP_KEYS};
use std::fs;
use std::path::Path;
use std::time::Instant;
use tempfile::tempdir;

const IDS_PER_TRACK: u32 = 200;
const TEXTURES_PER_DRAWABLE: u32 = 2;

fn write_dummy(path: &Path, contents: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, contents).unwrap();
}

/// Builds a pack with `IDS_PER_TRACK` drawables in every (gender, component)
/// and (gender, prop) track, each with `TEXTURES_PER_DRAWABLE` texture
/// variants — a large but realistic file count, well above what any single
/// real clothing pack ships, to stress the pipeline rather than merely
/// exercise it.
fn build_large_pack(root: &Path) -> (u32, u32) {
    write_dummy(
        &root.join("fxmanifest.lua"),
        b"fx_version 'cerulean'\ngame 'gta5'\nname 'large_perf_pack'\n",
    );

    let mut drawable_count = 0u32;
    let mut texture_count = 0u32;

    for gender_dir in ["male", "female"] {
        for (key, _) in PED_COMPONENT_KEYS {
            for id in 0..IDS_PER_TRACK {
                let mesh_name = format!("{key}_{id:03}_u.ydd");
                write_dummy(
                    &root.join(gender_dir).join("stream").join(&mesh_name),
                    format!("mesh-{gender_dir}-{key}-{id}").as_bytes(),
                );
                drawable_count += 1;
                for tex_id in 0..TEXTURES_PER_DRAWABLE {
                    let tex_name = format!("{key}_diff_{id:03}_{tex_id:03}_a_uni.ytd");
                    write_dummy(
                        &root.join(gender_dir).join("stream").join(&tex_name),
                        format!("tex-{gender_dir}-{key}-{id}-{tex_id}").as_bytes(),
                    );
                    texture_count += 1;
                }
            }
        }
        for (key, _) in PED_PROP_KEYS {
            for id in 0..IDS_PER_TRACK {
                let mesh_name = format!("p_{key}_{id:03}_u.ydd");
                write_dummy(
                    &root.join(gender_dir).join("stream").join(&mesh_name),
                    format!("propmesh-{gender_dir}-{key}-{id}").as_bytes(),
                );
                drawable_count += 1;
                for tex_id in 0..TEXTURES_PER_DRAWABLE {
                    let tex_name = format!("p_{key}_diff_{id:03}_{tex_id:03}_a_uni.ytd");
                    write_dummy(
                        &root.join(gender_dir).join("stream").join(&tex_name),
                        format!("proptex-{gender_dir}-{key}-{id}-{tex_id}").as_bytes(),
                    );
                    texture_count += 1;
                }
            }
        }
    }

    (drawable_count, texture_count)
}

#[test]
fn imports_a_large_synthetic_pack_correctly_and_within_a_generous_time_budget() {
    let src = tempdir().unwrap();
    let (expected_drawables, expected_textures) = build_large_pack(src.path());
    let total_files = expected_drawables + expected_textures;
    assert!(
        total_files > 8000,
        "pack should be large enough to actually stress the pipeline, got {total_files} files"
    );

    let db_dir = tempdir().unwrap();
    let db_path = db_dir.path().join("project.fcstudio").to_string_lossy().to_string();

    let started = Instant::now();
    let result = import_source(ImportSourceType::Folder, src.path().to_string_lossy().to_string(), db_path)
        .expect("import of a large well-formed pack should succeed");
    let elapsed = started.elapsed();

    assert!(result.report.errors.is_empty(), "unexpected errors: {:?}", result.report.errors);
    assert_eq!(result.report.drawables_found, expected_drawables);
    assert_eq!(result.report.textures_found, expected_textures);
    assert_eq!(result.items.len(), expected_drawables as usize);

    // Every item's assets were actually copied and hashed, not just counted.
    for item in &result.items {
        let mesh = item.mesh.as_ref().expect("every drawable in this pack has a mesh");
        assert!(mesh.present);
        assert_eq!(item.textures.len(), TEXTURES_PER_DRAWABLE as usize);
    }

    eprintln!(
        "imported {total_files} files ({expected_drawables} drawables, {expected_textures} textures) in {elapsed:?}"
    );
    assert!(
        elapsed.as_secs() < 60,
        "import of {total_files} files took {elapsed:?}, well beyond the generous regression-guard \
         ceiling (60s) — this points at an accidental quadratic-time regression, not normal variance"
    );
}
