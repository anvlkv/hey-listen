//! Theme-file commands (M11) — thin adapters over [`crate::themes`].
//!
//! The core stores installed themes as bytes; the frontend owns the `ThemeFile`
//! shape and validation (see `src/lib/themeFile.ts`). Native file pickers for
//! import/export run here (like the project pickers), so the frontend only receives
//! paths. See `docs/theming.md`.

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::themes::{self, InstalledTheme, ThemeError, THEME_EXTENSION};

/// The themes directory (shown in the Appearance popover).
#[tauri::command]
pub fn theme_dir(app: AppHandle) -> Result<String, ThemeError> {
    Ok(themes::theme_dir(&app)?.to_string_lossy().into_owned())
}

/// Every installed theme file (`{ id, content }`), sorted by id.
#[tauri::command]
pub fn list_themes(app: AppHandle) -> Result<Vec<InstalledTheme>, ThemeError> {
    themes::list(&app)
}

/// Save (or overwrite) an installed theme file.
#[tauri::command]
pub fn write_theme(app: AppHandle, id: String, content: String) -> Result<(), ThemeError> {
    themes::write(&app, &id, &content)
}

/// Remove an installed theme file (built-ins are refused).
#[tauri::command]
pub fn delete_theme(app: AppHandle, id: String) -> Result<(), ThemeError> {
    themes::delete(&app, &id)
}

/// Read a `.heyltheme` file's content (the import source; the frontend then saves it).
#[tauri::command]
pub fn import_theme_file(path: String) -> Result<String, ThemeError> {
    themes::read_file(&path)
}

/// Write theme content to `path` (the export destination).
#[tauri::command]
pub fn export_theme_file(path: String, content: String) -> Result<(), ThemeError> {
    themes::write_file(&path, &content)
}

/// Pick a `.heyltheme` file to import (native dialog).
///
/// Async so the blocking dialog runs off the main thread — a sync command would be
/// polled on the main thread and deadlock the event loop while the dialog is open.
#[tauri::command]
pub async fn pick_theme_import_path(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Import theme")
        .add_filter("Hey Listen theme", &[THEME_EXTENSION])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Pick where to export a theme (native dialog), pre-filled with `defaultName`.
///
/// Async for the same reason as [`pick_theme_import_path`].
#[tauri::command]
pub async fn pick_theme_export_path(app: AppHandle, default_name: String) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Export theme")
        .add_filter("Hey Listen theme", &[THEME_EXTENSION])
        .set_file_name(default_name)
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Reveal the themes directory in the OS file manager.
#[tauri::command]
pub fn reveal_theme_dir(app: AppHandle) -> Result<(), ThemeError> {
    themes::reveal(&app)
}
