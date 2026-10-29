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

use std::collections::HashSet;
use std::sync::atomic::{AtomicU32, Ordering};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Monotonic counter for unique window labels within this process.
static WINDOW_SEQ: AtomicU32 = AtomicU32::new(1);

/// Allocate a unique window label with the given prefix.
pub fn next_label(prefix: &str) -> String {
    let n = WINDOW_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{n}")
}

/// Bring a window to the front (un-minimize first: `set_focus` alone can leave it behind).
pub(crate) fn raise(window: &tauri::WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Create a popout window for `tool`, owned by `parent`'s project.
///
/// The alias is registered **before** the window loads, so its frontend can ask
/// `popout_tool` / `load_shared_source` and resolve to the parent project right away
/// (no race with the window's first paint).
fn create_popout(app: &AppHandle, parent: &str, tool_id: &str) -> Result<(), String> {
    let label = next_label("popout");
    let registry = app.state::<crate::state::WindowRegistry>();
    registry.add_popout(&label, parent, tool_id);

    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
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

/// Open a popout window for a single Workbench tool, or raise the one already open.
///
/// The new window is a view of the *calling* window's project: its label is
/// aliased to the caller's, so every command (source, analysis, preview) resolves
/// to the same [`crate::state::WindowState`]. The frontend asks [`popout_tool`]
/// which tool to render. One window per tool per project: popping the same tool out
/// again **raises** the existing window rather than opening a duplicate.
#[tauri::command]
pub async fn open_popout_window(
    window: tauri::WebviewWindow,
    tool_id: String,
) -> Result<(), String> {
    let app = window.app_handle();
    let registry = app.state::<crate::state::WindowRegistry>();
    if let Some(existing) = registry.popout_for(window.label(), &tool_id) {
        if let Some(popout) = app.get_webview_window(&existing) {
            raise(&popout);
            return Ok(());
        }
    }
    create_popout(app, window.label(), &tool_id)
}

/// Close every popout window of the calling project (tool **and** note views).
///
/// Used at the start of a **project load** (and a new project): those replace the whole
/// project, so a popout — a view of the old state — cannot be reused. Left open, it keeps
/// the old UI state locally and pushes it back through the UI sync while the loaded
/// state is being restored, which marked a freshly loaded project dirty (a stale timeline
/// zoom came back from the surviving view).
#[tauri::command]
pub async fn close_popouts(window: tauri::WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let registry = app.state::<crate::state::WindowRegistry>();
    let root = registry.root_label(window.label());
    for label in registry.popouts_of(&root) {
        if let Some(popout) = app.get_webview_window(&label) {
            if popout.destroy().is_ok() {
                registry.remove(&label);
            }
        } else {
            // Already gone: forget its alias/state anyway.
            registry.remove(&label);
        }
    }
    Ok(())
}

/// Make the calling project's tool popouts match `tools`.
///
/// Used when a project is **loaded** (or replaced by a new one): a load swaps the whole
/// project, so the previous project's popout windows — and any duplicate for a tool —
/// close, and the tools the loaded layout shows popped out get a window. Reconciling in
/// one command keeps the two halves (close then open) in a single order; doing it from
/// the frontend as a loop could leave a duplicate between the calls.
#[tauri::command]
pub async fn sync_popouts(window: tauri::WebviewWindow, tools: Vec<String>) -> Result<(), String> {
    let app = window.app_handle();
    let registry = app.state::<crate::state::WindowRegistry>();
    let root = registry.root_label(window.label());
    let live = app.webview_windows();

    // What is open *now*, per tool (skip windows that are already destroyed).
    let open: HashSet<String> = registry
        .project_windows(&root)
        .into_iter()
        .filter(|label| label != &root && live.contains_key(label))
        .filter_map(|label| registry.popout_tool(&label))
        .collect();

    // Close what the project no longer shows, and every window but the first for a tool
    // it does show — so a load can never leave two windows for one tool.
    let mut kept: HashSet<String> = HashSet::new();
    for label in registry.project_windows(&root) {
        if label == root || !live.contains_key(&label) {
            continue;
        }
        let Some(tool) = registry.popout_tool(&label) else {
            continue; // a note popout, not a tool view
        };
        let wanted = tools.iter().any(|candidate| candidate == &tool);
        let first = kept.insert(tool);
        if !wanted || !first {
            if let Some(popout) = app.get_webview_window(&label) {
                let _ = popout.destroy();
            }
        }
    }

    // Open the ones the project shows that had no window.
    for tool in tools {
        if !open.contains(&tool) {
            create_popout(app, &root, &tool)?;
        }
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
            raise(&popout);
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
    raise(&popout);
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
