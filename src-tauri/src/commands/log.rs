//! Log commands: where the log file is, its tail, and revealing it.
//!
//! Thin adapters over [`crate::logging`] — the plugin owns the file, and this module
//! only exposes it to the frontend (the Help menu's two actions are handled natively in
//! [`crate::menu`], so they work without a webview). See `docs/logging.md`.

use tauri::AppHandle;

use crate::logging::{self, LogError, LogPath, LogTail};

/// The **active** destination (`{ dir, file }`) — the E2E directory when that is in force.
#[tauri::command]
pub fn log_path(app: AppHandle) -> Result<LogPath, LogError> {
    logging::log_path(&app)
}

/// The end of the log file, for the preview window.
#[tauri::command]
pub fn read_log_tail(app: AppHandle) -> Result<LogTail, LogError> {
    logging::read_tail(&app)
}

/// Reveal the log directory in the OS file manager (Help → Open Log Folder).
#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), LogError> {
    logging::open_dir(&app)
}
