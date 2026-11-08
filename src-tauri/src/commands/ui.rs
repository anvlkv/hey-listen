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

/// One UI-state patch (mirrored to the project's other windows).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UiStateEvent {
    key: String,
    value: serde_json::Value,
    /// The revision the patch was stored at, so a window pulling a snapshot can tell a
    /// newer patch in the startup gap from one the snapshot already contains.
    revision: u64,
    /// The window that made the change, so it can ignore its own echo.
    source: String,
}

/// Store a UI-state patch and broadcast it to the project's other windows.
#[tauri::command]
pub fn set_ui_state(app: AppHandle, window: WebviewWindow, key: String, value: serde_json::Value) {
    let state = window_state(&window);
    let Some(revision) = state.set_ui(&key, value.clone()) else {
        return;
    };
    let registry = app.state::<WindowRegistry>();
    let event = UiStateEvent {
        key,
        value,
        revision,
        source: window.label().to_string(),
    };
    for label in registry.project_windows(window.label()) {
        if label == window.label() {
            continue;
        }
        let _ = app.emit_to(&label, "ui-state", event.clone());
    }
}
