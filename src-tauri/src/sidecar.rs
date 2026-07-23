//! Invokes the bundled `codewalker-bridge` .NET sidecar (see
//! `sidecar/CodeWalkerBridge/`), which does the actual `.ydd`/`.ytd` object
//! graph decoding via the real CodeWalker.Core library. This module only
//! knows how to run the process and parse its JSON stdout — it has no
//! knowledge of the RAGE resource format itself (see `parsers::rage_resource`
//! for the one piece of that this app does handle natively).

use crate::error::{AppError, AppResult};
use serde::de::DeserializeOwned;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

pub async fn run_sidecar<T: DeserializeOwned>(app: &AppHandle, args: Vec<String>) -> AppResult<T> {
    let shell = app.shell();
    let command = shell
        .sidecar("codewalker-bridge")
        .map_err(|e| AppError(format!("Failed to resolve the codewalker-bridge sidecar: {e}")))?
        .args(args);

    let output = command
        .output()
        .await
        .map_err(|e| AppError(format!("Failed to run the codewalker-bridge sidecar: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError(format!(
            "codewalker-bridge produced no output (exit code {:?}). stderr: {}",
            output.status.code(),
            stderr.trim()
        )));
    }

    serde_json::from_str::<T>(trimmed).map_err(|e| {
        AppError(format!(
            "Failed to parse codewalker-bridge output as JSON: {e}. Raw output: {trimmed}"
        ))
    })
}
