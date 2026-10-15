//! Theme-file storage (M11) — the exchangeable-theme store.
//!
//! Themes are **chrome**, not project data, so they live in the app **config**
//! directory (mirroring [`crate::recent`]):
//!
//! ```text
//! <app config dir>/themes/<id>.heyltheme
//! ```
//!
//! The frontend owns the shape (a `ThemeFile` — see `src/lib/themeFile.ts`); Rust
//! only **stores bytes**. This module provides the store (list / write / delete) plus
//! the import/export file plumbing, and the bundled themes' identity for the
//! **headless** MCP surface (which has no webview to run the TypeScript registry).
//! See `docs/theming.md` and ADR-15.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// The theme file extension (without the dot).
pub const THEME_EXTENSION: &str = "heyltheme";

/// Directory (under the app config dir) that holds installed themes.
const DIR_NAME: &str = "themes";

#[derive(Debug, thiserror::Error)]
pub enum ThemeError {
    #[error("could not access the theme store: {0}")]
    Io(#[from] std::io::Error),
    #[error("no app config directory is available")]
    NoConfigDir,
    #[error("invalid theme id: {0}")]
    InvalidId(String),
    #[error("built-in themes cannot be modified")]
    Builtin,
    #[error("theme not found: {0}")]
    NotFound(String),
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(ThemeError);

/// One installed theme file: its id (the file stem) and raw JSON content.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InstalledTheme {
    pub id: String,
    pub content: String,
}

/// The bundled themes' identity `(id, name, base)`.
///
/// Mirrors the built-in registry in `src/state/themes/builtins.ts` (`BUILTIN_THEMES`) — the
/// webview applies the full palettes from TypeScript, but the **headless** MCP server
/// has no webview, so it reports the bundled themes from here. Keep the two lists in
/// sync when adding a bundled theme.
pub const BUILTIN_THEMES: &[(&str, &str, &str)] = &[
    ("builtin:dark", "Dark", "dark"),
    ("builtin:light", "Light", "light"),
    ("builtin:retrowave-neon", "Retrowave Neon", "dark"),
    ("builtin:nord", "Nord", "dark"),
    ("builtin:solarized-dark", "Solarized Dark", "dark"),
    ("builtin:solarized-light", "Solarized Light", "light"),
];

/// Whether `id` names a bundled (undeletable) theme.
pub fn is_builtin(id: &str) -> bool {
    BUILTIN_THEMES.iter().any(|(builtin, _, _)| *builtin == id)
}

/// The bundled themes as JSON summaries (for the headless MCP surface).
pub fn builtin_summaries() -> Vec<serde_json::Value> {
    BUILTIN_THEMES
        .iter()
        .map(|(id, name, base)| {
            serde_json::json!({ "id": id, "name": name, "base": base, "builtin": true })
        })
        .collect()
}

/// The bundled theme's summary for `id`, if it is one.
pub fn builtin_summary(id: &str) -> Option<serde_json::Value> {
    BUILTIN_THEMES
        .iter()
        .find(|(builtin, _, _)| *builtin == id)
        .map(|(id, name, base)| {
            serde_json::json!({ "id": id, "name": name, "base": base, "builtin": true })
        })
}

/// The themes directory (created lazily on write / reveal).
pub fn theme_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, ThemeError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|_| ThemeError::NoConfigDir)?
        .join(DIR_NAME);
    Ok(dir)
}

/// Every installed theme file, sorted by id. A missing directory is "no themes".
pub fn list<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<InstalledTheme>, ThemeError> {
    let dir = theme_dir(app)?;
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };

    let mut themes = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some(THEME_EXTENSION) {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        match std::fs::read_to_string(&path) {
            Ok(content) => themes.push(InstalledTheme {
                id: id.to_string(),
                content,
            }),
            Err(err) => log::warn!("could not read theme {}: {err}", path.display()),
        }
    }
    themes.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(themes)
}

/// Write (or overwrite) an installed theme file.
pub fn write<R: Runtime>(app: &AppHandle<R>, id: &str, content: &str) -> Result<(), ThemeError> {
    let path = theme_path(app, id)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, content)?;
    Ok(())
}

/// Delete an installed theme file.
pub fn delete<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<(), ThemeError> {
    let path = theme_path(app, id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Err(ThemeError::NotFound(id.to_string()))
        }
        Err(err) => Err(err.into()),
    }
}

/// Read a `.heyltheme` file from an arbitrary path (the import source).
pub fn read_file(path: &str) -> Result<String, ThemeError> {
    Ok(std::fs::read_to_string(path)?)
}

/// Write theme content to an arbitrary path (the export destination).
pub fn write_file(path: &str, content: &str) -> Result<(), ThemeError> {
    if let Some(dir) = Path::new(path).parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

/// Reveal the themes directory in the OS file manager (creating it first).
pub fn reveal<R: Runtime>(app: &AppHandle<R>) -> Result<(), ThemeError> {
    let dir = theme_dir(app)?;
    std::fs::create_dir_all(&dir)?;
    open_in_file_manager(&dir);
    Ok(())
}

/// Resolve `<config>/themes/<id>.heyltheme`, validating the id.
fn theme_path<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf, ThemeError> {
    if is_builtin(id) {
        return Err(ThemeError::Builtin);
    }
    validate_id(id)?;
    Ok(theme_dir(app)?.join(format!("{id}.{THEME_EXTENSION}")))
}

/// A theme id must be a safe file stem: non-empty, no path separators or `..`.
fn validate_id(id: &str) -> Result<(), ThemeError> {
    let safe = !id.is_empty()
        && id != ".."
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'));
    if safe {
        Ok(())
    } else {
        Err(ThemeError::InvalidId(id.to_string()))
    }
}

/// Open a directory in the platform's file manager.
fn open_in_file_manager(dir: &Path) {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";

    if let Err(err) = std::process::Command::new(program).arg(dir).spawn() {
        log::warn!("could not open {}: {err}", dir.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_theme_ids() {
        assert!(validate_id("retrowave-neon").is_ok());
        assert!(validate_id("nord_2").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id("..").is_err());
        assert!(validate_id("../escape").is_err());
        assert!(validate_id("a/b").is_err());
        assert!(validate_id(".hidden").is_err());
    }

    #[test]
    fn bundled_ids_are_unique_and_marked() {
        let mut ids: Vec<&str> = BUILTIN_THEMES.iter().map(|(id, _, _)| *id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "bundled theme ids must be unique");
        assert!(is_builtin("builtin:dark"));
        assert!(!is_builtin("retrowave-neon"));
    }
}
