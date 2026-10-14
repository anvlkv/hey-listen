//! Tauri IPC commands, grouped by domain.
//!
//! Commands are thin adapters over the engines in [`crate::audio`]: they own the
//! IPC boundary (argument/return types, `Channel`s) but keep the audio work in
//! the engine modules. See `docs/architecture.md` for the planned inventory.

pub mod analysis;
pub mod app;
pub mod capture;
pub mod decode;
pub mod graph;
pub mod mcp;
pub mod playback;
pub mod project;
pub mod source;
pub mod stream;
pub mod themes;
pub mod ui;
pub mod window;

use tauri::{AppHandle, Manager, Runtime};

/// The label of the focused window, else `main`, else any window.
///
/// Shared by the menu (routing File/Edit actions to the project the user is looking
/// at) and the file-open handling in [`project`], so both pick the same window.
pub(crate) fn focused_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let windows = app.webview_windows();
    windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone())
        .or_else(|| windows.contains_key("main").then(|| "main".to_string()))
        .or_else(|| windows.keys().next().cloned())
}
