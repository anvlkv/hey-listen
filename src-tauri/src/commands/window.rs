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

use crate::audio::analyzers::ToolId;

pub mod project;

/// Monotonic counter for unique window labels within this process.
static WINDOW_SEQ: AtomicU32 = AtomicU32::new(1);

/// Allocate a unique window label with the given prefix.
pub fn next_label(prefix: &str) -> String {
    let n = WINDOW_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{n}")
}

/// Bring a window to the front (un-minimize first: `set_focus` alone can leave it behind).
pub(crate) fn raise<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Create a popout window for `tool`, owned by `parent`'s project.
///
/// The alias is registered **before** the window loads, so its frontend can ask
/// `popout_tool` / `load_shared_source` and resolve to the parent project right away
/// (no race with the window's first paint).
fn create_popout(app: &AppHandle, parent: &str, tool_id: ToolId) -> Result<(), String> {
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
    tool_id: ToolId,
) -> Result<(), String> {
    let app = window.app_handle();
    let registry = app.state::<crate::state::WindowRegistry>();
    if let Some(existing) = registry.popout_for(window.label(), tool_id) {
        if let Some(popout) = app.get_webview_window(&existing) {
            raise(&popout);
            return Ok(());
        }
    }
    create_popout(app, window.label(), tool_id)
}

/// Close every popout window of the calling project (tool **and** annotation views).
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
        // The log preview is **app-wide** content: a load replaces the old project's
        // views, and the log is not one of them — otherwise every File → Open would
        // close the preview.
        if registry.popout_log(&label) {
            continue;
        }
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
pub async fn sync_popouts(window: tauri::WebviewWindow, tools: Vec<ToolId>) -> Result<(), String> {
    let app = window.app_handle();
    let registry = app.state::<crate::state::WindowRegistry>();
    let root = registry.root_label(window.label());
    let live = app.webview_windows();

    // What is open *now*, per tool (skip windows that are already destroyed).
    let open: HashSet<ToolId> = registry
        .project_windows(&root)
        .into_iter()
        .filter(|label| label != &root && live.contains_key(label))
        .filter_map(|label| registry.popout_tool(&label))
        .collect();

    // Close what the project no longer shows, and every window but the first for a tool
    // it does show — so a load can never leave two windows for one tool.
    let mut kept: HashSet<ToolId> = HashSet::new();
    for label in registry.project_windows(&root) {
        if label == root || !live.contains_key(&label) {
            continue;
        }
        let Some(tool) = registry.popout_tool(&label) else {
            continue; // an annotation popout, not a tool view
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
            create_popout(app, &root, tool)?;
        }
    }

    Ok(())
}

/// Open a popout window for a single annotation.
///
/// Like [`open_popout_window`], the new window is a *view* of the *calling* window's
/// project: its label is aliased (with the annotation id) to the caller's, so every command
/// resolves to the same [`crate::state::WindowState`]. An annotation that already has a
/// window is **raised** instead of opened twice, and the frontend asks [`popout_annotation`]
/// which annotation to render.
#[tauri::command]
pub async fn open_annotation_window(
    window: tauri::WebviewWindow,
    annotation_id: String,
) -> Result<(), String> {
    let app = window.app_handle();
    let registry = app.state::<crate::state::WindowRegistry>();

    // An annotation already shown in this project's windows is raised, not duplicated.
    if let Some(existing) = registry.annotation_popout_for(window.label(), &annotation_id) {
        if let Some(popout) = app.get_webview_window(&existing) {
            raise(&popout);
            return Ok(());
        }
    }

    let label = next_label("annotation");
    let parent = window.label().to_string();

    // Register the alias *before* the window loads, so its frontend can ask
    // `popout_annotation` / `load_shared_source` and resolve to the parent project right
    // away (no race with the window's first paint).
    registry.add_annotation_popout(&label, &parent, &annotation_id);

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
pub fn popout_tool(window: tauri::WebviewWindow) -> Option<ToolId> {
    window
        .app_handle()
        .state::<crate::state::WindowRegistry>()
        .popout_tool(window.label())
}

/// The annotation a popout window shows, or `None` for a regular project window.
#[tauri::command]
pub fn popout_annotation(window: tauri::WebviewWindow) -> Option<String> {
    window
        .app_handle()
        .state::<crate::state::WindowRegistry>()
        .popout_annotation(window.label())
}

/// Open (or raise) the **log preview**, aliased to `parent`'s project.
///
/// One window for the whole app (a singleton): an existing preview is raised, whichever
/// project opened it. It is still a *view* (ADR-11), so it closes with the window it was
/// opened from and its commands resolve to that project, while `popout_log` tells its
/// frontend which list to render. Registered **before** the window loads, so the first
/// paint can already ask.
pub(crate) fn open_log_window_for<R: tauri::Runtime>(
    app: &AppHandle<R>,
    parent: &str,
) -> Result<String, String> {
    let registry = app.state::<crate::state::WindowRegistry>();
    if let Some(existing) = registry.log_popout() {
        if let Some(popout) = app.get_webview_window(&existing) {
            raise(&popout);
            return Ok(existing.to_owned());
        }
        registry.remove(&existing);
    }

    let label = next_label("popout");
    registry.add_log_popout(&label, parent);
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Log — Hey Listen")
        .inner_size(900.0, 640.0)
        .min_inner_size(520.0, 360.0)
        .build();

    if let Err(err) = built {
        registry.remove(&label);
        return Err(err.to_string());
    }
    Ok(label)
}

/// Open the log preview for the calling window's project (Help → Show Log… calls
/// [`open_log_window_for`] directly: it needs no webview).
#[tauri::command]
pub async fn open_log_window(window: tauri::WebviewWindow) -> Result<String, String> {
    open_log_window_for(window.app_handle(), window.label())
}

/// Open (or raise) the app-wide **Keyboard Shortcuts** window.
///
/// A singleton like the log preview, but it is not a project *view*: it shows the
/// app-level keybinding configuration, so it is neither aliased to a project nor tracked
/// by [`crate::state::WindowRegistry`], and it survives a project load. An existing window
/// is raised rather than duplicated.
pub(crate) fn open_shortcuts_window_for<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("shortcuts") {
        raise(&existing);
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "shortcuts", WebviewUrl::App("index.html".into()))
        .title("Keyboard Shortcuts — Hey Listen")
        .inner_size(760.0, 720.0)
        .min_inner_size(520.0, 420.0)
        .build()
        .map_err(|err| err.to_string())?;
    Ok(())
}

/// Open (or raise) the Keyboard Shortcuts window (Help → Keyboard Shortcuts… calls
/// [`open_shortcuts_window_for`] directly: it needs no webview).
#[tauri::command]
pub async fn open_shortcuts_window(app: AppHandle) -> Result<(), String> {
    open_shortcuts_window_for(&app)
}

/// Whether the calling window shows the log preview.
#[tauri::command]
pub fn popout_log(window: tauri::WebviewWindow) -> bool {
    window
        .app_handle()
        .state::<crate::state::WindowRegistry>()
        .popout_log(window.label())
}

/// The tools currently popped out of the calling window's project.
#[tauri::command]
pub fn popout_tools(window: tauri::WebviewWindow) -> Vec<ToolId> {
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
pub fn focus_popout(window: tauri::WebviewWindow, tool_id: ToolId) -> bool {
    let app = window.app_handle();
    let registry = app.state::<crate::state::WindowRegistry>();
    let Some(label) = registry.popout_for(window.label(), tool_id) else {
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
