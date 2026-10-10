//! Recent project files (M6) — up to [`MAX_RECENT`], persisted to the app config
//! directory so the list survives restarts.
//!
//! The list backs the native **File → Open Recent** submenu (see `menu.rs`) and is
//! updated by the frontend (through the `add_recent_project` /
//! `clear_recent_projects` commands) whenever a project is opened or saved.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

/// How many recent projects to keep.
pub const MAX_RECENT: usize = 10;

/// File name under the app config directory.
const FILE_NAME: &str = "recent-projects.json";

/// One remembered project file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    /// Absolute path of the project file.
    pub path: String,
    /// Display label — the file's base name without its extension.
    pub name: String,
    /// Unix milliseconds of the last open/save.
    pub opened_ms: u64,
}

/// The recent list, behind a lock (one window = one project, but the list is shared).
#[derive(Default)]
pub struct RecentProjects(Mutex<Vec<RecentProject>>);

impl RecentProjects {
    /// Load the list from disk into a fresh state (called once in `setup`).
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        Self(Mutex::new(read_store(app)))
    }

    /// The current list, most-recent first.
    pub fn list(&self) -> Vec<RecentProject> {
        self.0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    fn set(&self, items: Vec<RecentProject>) {
        *self.0.lock().unwrap_or_else(|poison| poison.into_inner()) = items;
    }

    /// Move `path` to the front (deduped) and cap the list at [`MAX_RECENT`].
    fn push(&self, path: &str) -> Vec<RecentProject> {
        let name = display_name(path);
        let mut guard = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        guard.retain(|item| item.path != path);
        guard.insert(
            0,
            RecentProject {
                path: path.to_string(),
                name,
                opened_ms: now_ms(),
            },
        );
        guard.truncate(MAX_RECENT);
        guard.clone()
    }
}

/// Record a project file as recently used, returning the new list.
pub fn record<R: Runtime>(app: &AppHandle<R>, path: &str) -> Vec<RecentProject> {
    let items = app.state::<RecentProjects>().push(path);
    write_store(app, &items);
    items
}

/// Forget every recent project, returning the (empty) list.
pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Vec<RecentProject> {
    app.state::<RecentProjects>().set(Vec::new());
    write_store(app, &[]);
    Vec::new()
}

/// The recent projects whose files still exist (for the menu).
pub fn existing<R: Runtime>(app: &AppHandle<R>) -> Vec<RecentProject> {
    app.state::<RecentProjects>()
        .list()
        .into_iter()
        .filter(|item| Path::new(&item.path).exists())
        .collect()
}

fn display_name(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(path)
        .to_string()
}

fn store_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME))
}

fn read_store<R: Runtime>(app: &AppHandle<R>) -> Vec<RecentProject> {
    let Some(path) = store_path(app) else {
        return Vec::new();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return Vec::new();
    };
    let mut items: Vec<RecentProject> = serde_json::from_slice(&bytes).unwrap_or_default();
    items.truncate(MAX_RECENT);
    items
}

fn write_store<R: Runtime>(app: &AppHandle<R>, items: &[RecentProject]) {
    let Some(path) = store_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_vec_pretty(items) {
        let _ = std::fs::write(&path, json);
    }
}

/// Current Unix time in milliseconds (shared by the recent list and the project
/// file store, so both stamp `opened_ms` / `modified_ms` the same way).
pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}
