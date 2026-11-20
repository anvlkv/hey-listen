//! Project UI-state sync.
//!
//! The core owns the project's shared UI state (timeline window/view, analysis
//! params, per-tool options and chart views, project name, popped-out tools). The
//! frontend owns the *shape*; the core stores it and broadcasts each patch to the
//! project's other windows, so the main window and its popouts are views of the
//! same state instead of diverging copies.

use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::state::{window_state, WindowRegistry};

/// The event carrying one [`UiStateEvent`] patch.
pub(crate) const UI_STATE_EVENT: &str = "ui-state";

/// The whole UI state plus the revision it was read at.
///
/// A window that pulls this on load subscribes to `ui-state` first and then applies the
/// snapshot; a patch whose revision is higher than `revision` is newer than the snapshot
/// and must be replayed, so a peer write during startup cannot be lost (audit P2 #11).
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UiSnapshot {
    pub values: HashMap<String, serde_json::Value>,
    pub revision: u64,
}

/// The whole UI state (plus its revision), for a freshly opened window to pull on load.
#[tauri::command]
pub fn get_ui_state(window: WebviewWindow) -> UiSnapshot {
    let state = window_state(&window);
    let values = state.ui_snapshot();
    UiSnapshot {
        values,
        revision: state.ui_revision(),
    }
}

/// One UI-state patch (mirrored to the project's windows).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UiStateEvent {
    key: String,
    value: serde_json::Value,
    /// The revision the patch was stored at, so a window pulling a snapshot can tell a
    /// newer patch in the startup gap from one the snapshot already contains.
    revision: u64,
    /// The window the change is attributed to, so it can ignore its own echo.
    source: String,
}

/// Store a UI-state patch and broadcast it to the project's other windows.
#[tauri::command]
pub fn set_ui_state(app: AppHandle, window: WebviewWindow, key: String, value: serde_json::Value) {
    let state = window_state(&window);
    let Some(revision) = state.set_ui(&key, value.clone()) else {
        return;
    };
    let label = window.label().to_string();
    broadcast_ui_patch(&app, &label, key, value, revision, &label, false);
}

/// Broadcast a **stored** UI-state patch to `label`'s project.
///
/// `label` names the calling window (it resolves the project); `source` is the window the
/// patch is attributed to. The source is skipped unless `include_source`: a local edit
/// must not be echoed back to its window, while a history restore addresses every view.
pub(crate) fn broadcast_ui_patch(
    app: &AppHandle,
    label: &str,
    key: String,
    value: serde_json::Value,
    revision: u64,
    source: &str,
    include_source: bool,
) {
    let registry = app.state::<WindowRegistry>();
    let event = UiStateEvent {
        key,
        value,
        revision,
        source: source.to_string(),
    };
    for window in registry.project_windows(label) {
        if !include_source && window == source {
            continue;
        }
        let _ = app.emit_to(&window, UI_STATE_EVENT, event.clone());
    }
}
