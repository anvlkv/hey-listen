//! Window-management commands (M7).
//!
//! Hey Listen runs **N independent project windows**; a window is the unit of a
//! project (ADR-3). Each window is a separate webview, so the frontend state is
//! naturally per-window and the core state is keyed by window label in
//! [`crate::state::WindowRegistry`].
//!
//! A **popout** (a tab moved to its own window) is a *view* of a project, not a
//! project of its own: only Tauri/wry create and manage windows, and the frontend
//! merely renders the data. So a popout is a real Tauri window whose label is
//! aliased to its parent's project state (the shared source / filter / playback),
//! and which runs the app in "popout" mode to show a single tool.

use std::sync::atomic::{AtomicU32, Ordering};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Monotonic counter for unique window labels within this process.
static WINDOW_SEQ: AtomicU32 = AtomicU32::new(1);

/// Allocate a unique window label with the given prefix.
pub fn next_label(prefix: &str) -> String {
    let n = WINDOW_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{n}")
}

/// Open a popout window for a single Workbench tool.
///
/// The new window is a view of the *calling* window's project: its label is
/// aliased to the caller's, so every command (source, analysis, preview) resolves
/// to the same [`crate::state::WindowState`]. The frontend asks [`popout_tool`]
/// which tool to render.
#[tauri::command]
pub async fn open_popout_window(
    window: tauri::WebviewWindow,
    tool_id: String,
) -> Result<(), String> {
    let label = next_label("popout");
    let parent = window.label().to_string();

    // Register the alias *before* the window loads, so its frontend can ask
    // `popout_tool` / `load_shared_source` and resolve to the parent project right
    // away (no race with the window's first paint).
    let registry = window.app_handle().state::<crate::state::WindowRegistry>();
    registry.add_popout(&label, &parent, &tool_id);

    let built = WebviewWindowBuilder::new(
        window.app_handle(),
        &label,
        WebviewUrl::App("index.html".into()),
    )
    .title("Hey Listen")
    .inner_size(900.0, 640.0)
    .min_inner_size(480.0, 360.0)
    .build();

    if let Err(err) = built {
        registry.remove(&label);
        return Err(err.to_string());
    }

    Ok(())
}

/// Open a popout window for a single note.
///
/// Like [`open_popout_window`], the new window is a *view* of the *calling* window's
/// project: its label is aliased (with the note id) to the caller's, so every command
/// resolves to the same [`crate::state::WindowState`]. A note that already has a
/// window is **raised** instead of opened twice, and the frontend asks [`popout_note`]
/// which note to render.
#[tauri::command]
pub async fn open_note_window(window: tauri::WebviewWindow, note_id: String) -> Result<(), String> {
    let app = window.app_handle();
    let registry = app.state::<crate::state::WindowRegistry>();

    // A note already shown in this project's windows is raised, not duplicated.
    if let Some(existing) = registry.note_popout_for(window.label(), &note_id) {
        if let Some(popout) = app.get_webview_window(&existing) {
            let _ = popout.unminimize();
            let _ = popout.set_focus();
            return Ok(());
        }
    }

    let label = next_label("note");
    let parent = window.label().to_string();

    // Register the alias *before* the window loads, so its frontend can ask
    // `popout_note` / `load_shared_source` and resolve to the parent project right
    // away (no race with the window's first paint).
    registry.add_note_popout(&label, &parent, &note_id);

    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Hey Listen")
        .inner_size(640.0, 560.0)
        .min_inner_size(360.0, 300.0)
        .build();

    if let Err(err) = built {
        registry.remove(&label);
        return Err(err.to_string());
    }

    Ok(())
}

/// The tool a popout window shows, or `None` for a regular project window.
#[tauri::command]
pub fn popout_tool(window: tauri::WebviewWindow) -> Option<String> {
    window
        .app_handle()
        .state::<crate::state::WindowRegistry>()
        .popout_tool(window.label())
}

/// The note a popout window shows, or `None` for a regular project window.
#[tauri::command]
pub fn popout_note(window: tauri::WebviewWindow) -> Option<String> {
    window
        .app_handle()
        .state::<crate::state::WindowRegistry>()
        .popout_note(window.label())
}

/// The tools currently popped out of the calling window's project.
#[tauri::command]
pub fn popout_tools(window: tauri::WebviewWindow) -> Vec<String> {
    window
        .app_handle()
        .state::<crate::state::WindowRegistry>()
        .popout_tools_of(window.label())
}

/// Raise the popout window showing `tool_id` for the calling window's project.
///
/// Selecting a tool that is already popped out must not open a duplicate tab in the
/// main window (the "no duplicate analyzer tabs" rule): it raises the popout
/// instead. Returns `true` when a popout was found and focused.
#[tauri::command]
pub fn focus_popout(window: tauri::WebviewWindow, tool_id: String) -> bool {
    let app = window.app_handle();
    let registry = app.state::<crate::state::WindowRegistry>();
    let Some(label) = registry.popout_for(window.label(), &tool_id) else {
        return false;
    };
    let Some(popout) = app.get_webview_window(&label) else {
        return false;
    };
    let _ = popout.unminimize();
    let _ = popout.set_focus();
    true
}

/// Open a new, independent project window.
///
/// The new window starts on a fresh, empty project (its own frontend and core
/// state); the current window is untouched. Asynchronous because creating a window
/// from a synchronous command deadlocks on Windows (see the Tauri docs for
/// `WebviewWindowBuilder::new`).
#[tauri::command]
pub async fn open_project_window(app: AppHandle) -> Result<(), String> {
    let label = next_label("project");
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Hey Listen")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .build()
        .map_err(|err| err.to_string())?;
    Ok(())
}
