pub mod commands;
pub mod db;
pub mod error;
pub mod fs_utils;
pub mod models;
pub mod parsers;
pub mod sidecar;
pub mod slot_system;
pub mod texture_decode;
pub mod texture_encode;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::project_create,
            commands::project::project_open,
            commands::project::project_save,
            commands::import::import_source,
            commands::export::export_project,
            commands::assets::import_asset_file,
            commands::assets::duplicate_asset_file,
            commands::inspect::inspect_ytd,
            commands::inspect::inspect_ydd,
            commands::inspect::sidecar_probe,
            commands::preview::export_geometry,
            commands::preview::decode_texture_png,
            commands::preview::decode_texture_thumbnail,
            commands::preview::export_texture_png,
            commands::preview::copy_file,
            commands::repair::repair_ytd,
            commands::repair::repair_ydd,
            commands::repair::refresh_asset_ref,
            commands::deep_validate::deep_validate_project,
            commands::texture_edit::apply_texture_edit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
