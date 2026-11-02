//! Project windows opened at a project file (M25.D).
//!
//! Two callers need this: the compare view's **Open reference** button (a saved
//! reference with no window) and the app-only MCP `open_project_window` tool (scripting
//! an app-side A/B without touching the current project). A new window learns its path
//! through [`PendingWindowPaths`]: its frontend drains the entry once on startup
//! (`take_window_open_path`), which avoids racing a window that is still loading.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::state::WindowRegistry;

use super::{next_label, raise};

/// A project file a new window should open, keyed by that window's label.
#[derive(Default)]
pub struct PendingWindowPaths(Mutex<HashMap<String, String>>);

impl PendingWindowPaths {
    fn put(&self, label: &str, path: String) {
        self.0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .insert(label.to_string(), path);
    }

    fn remove(&self, label: &str) {
        self.0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(label);
    }

    fn take(&self, label: &str) -> Option<String> {
        self.0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(label)
    }
}

/// The path this window was created to open, drained once (`None` for a plain window).
#[tauri::command]
pub fn take_window_open_path(window: WebviewWindow) -> Option<String> {
    window
        .app_handle()
        .state::<PendingWindowPaths>()
        .take(window.label())
}

/// Create a project window that opens `path` once its frontend is ready; returns its label.
pub(crate) fn open_project_window_at(app: &AppHandle, path: String) -> Result<String, String> {
    let label = next_label("project");
    app.state::<PendingWindowPaths>().put(&label, path);
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Hey Listen")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .build();
    if let Err(err) = built {
        app.state::<PendingWindowPaths>().remove(&label);
        return Err(err.to_string());
    }
    Ok(label)
}

/// Open a project window at a `.heyl` file (app-only MCP `open_project_window`).
///
/// A window that already shows the file is raised instead of duplicated, and the
/// label is returned so an MCP caller can `target` it (or pass it as `with` to
/// `compare_analysis`).
#[tauri::command]
pub async fn open_project_window_at_path(app: AppHandle, path: String) -> Result<Value, String> {
    validate_project_file(&path)?;
    let (label, reused) = open_file_window(&app, &path)?;
    Ok(json!({ "label": label, "path": path, "reused": reused }))
}

/// Open a project window at `path`, raising one that already shows it.
///
/// Returns the window label and whether an existing window was reused. Callers that
/// accept an arbitrary path validate it first.
pub(crate) fn open_file_window(app: &AppHandle, path: &str) -> Result<(String, bool), String> {
    if let Some(existing) = project_window_showing(app, path) {
        raise(&existing);
        return Ok((existing.label().to_string(), true));
    }
    open_project_window_at(app, path.to_string()).map(|label| (label, false))
}

/// A project window opens only an existing `.heyl` file (case-insensitive extension).
fn validate_project_file(path: &str) -> Result<(), String> {
    let path_ref = std::path::Path::new(path);
    if !path_ref.is_file() {
        return Err(format!("no project file at {path}"));
    }
    let is_project = path_ref
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("heyl"));
    if !is_project {
        return Err(format!("{path} is not a .heyl project file"));
    }
    Ok(())
}

/// The open project window (never a popout) whose project path is `path`.
fn project_window_showing(app: &AppHandle, path: &str) -> Option<WebviewWindow> {
    let registry = app.state::<WindowRegistry>();
    let mut labels: Vec<String> = app.webview_windows().into_keys().collect();
    labels.sort();
    for label in labels {
        if registry.is_popout(&label) {
            continue;
        }
        let Some(state) = registry.peek(&label) else {
            continue;
        };
        let shown = state
            .ui_snapshot()
            .get("project")
            .and_then(|project| project.get("path"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if shown.as_deref() == Some(path) {
            if let Some(window) = app.get_webview_window(&label) {
                return Some(window);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::validate_project_file;

    #[test]
    fn a_project_window_requires_an_existing_heyl_file() {
        let dir = std::env::temp_dir().join(format!(
            "hey_listen_window_{}_{}",
            std::process::id(),
            "heyl"
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let project = dir.join("song.HEYL");
        std::fs::write(&project, b"x").unwrap();
        let audio = dir.join("song.wav");
        std::fs::write(&audio, b"x").unwrap();

        assert!(validate_project_file(&project.to_string_lossy()).is_ok());
        assert!(validate_project_file(&audio.to_string_lossy()).is_err());
        let missing = dir.join("missing.heyl");
        assert!(validate_project_file(&missing.to_string_lossy()).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
