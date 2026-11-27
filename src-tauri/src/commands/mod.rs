//! Tauri IPC commands, grouped by domain.
//!
//! Commands are thin adapters over the engines in [`crate::audio`]: they own the
//! IPC boundary (argument/return types, `Channel`s) but keep the audio work in
//! the engine modules. See for the planned inventory.

pub mod analysis;
pub mod app;
pub mod audio_export;
pub mod capture;
pub mod cli_install;
pub mod compare;
pub mod decode;
pub mod dirty;
pub mod export;
pub mod graph;
pub mod history;
pub mod log;
pub mod mcp;
pub mod playback;
pub mod project;
pub mod source;
pub mod stream;
pub mod themes;
pub mod ui;
#[cfg(desktop)]
pub mod update;
pub mod window;

use tauri::{AppHandle, Manager, Runtime};

/// The label of the **project** window the user is looking at, else `main`, else any
/// project window.
///
/// Shared by the menu (routing File/Edit actions to the project the user is looking
/// at) and the file-open handling in [`project`], so both pick the same window.
///
/// A focused **popout** resolves to the project window that owns it: a popout is a view
/// and does not listen for `app:menu` / `app:open-project`, so addressing it would drop
/// the action. The app-wide windows (the manual, the shortcut sheet) carry no project at
/// all, so they are skipped too: an action fired while one has focus still reaches the
/// project behind it.
pub(crate) fn focused_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let windows = app.webview_windows();
    let project = |focused_only: bool| {
        windows
            .iter()
            .find(|(label, window)| {
                !crate::commands::window::is_app_window(label)
                    && (!focused_only || window.is_focused().unwrap_or(false))
            })
            .map(|(label, _)| label.clone())
    };
    let focused = project(true)
        .or_else(|| windows.contains_key("main").then(|| "main".to_string()))
        .or_else(|| project(false))
        .or_else(|| windows.keys().next().cloned());
    focused.map(|label| {
        // `focused_label` is also reached from OS callbacks that can arrive before
        // `setup` managed the registry (and a panic there aborts the process).
        app.try_state::<crate::state::WindowRegistry>()
            .map(|registry| registry.root_label(&label))
            .unwrap_or(label)
    })
}
