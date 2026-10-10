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

/// The whole UI state, for a freshly opened window to pull on load.
#[tauri::command]
pub fn get_ui_state(window: WebviewWindow) -> HashMap<String, serde_json::Value> {
    window_state(&window).ui_snapshot()
}

/// One UI-state patch (mirrored to the project's other windows).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UiStateEvent {
    key: String,
    value: serde_json::Value,
    /// The window that made the change, so it can ignore its own echo.
    source: String,
}

/// Store a UI-state patch and broadcast it to the project's other windows.
#[tauri::command]
pub fn set_ui_state(app: AppHandle, window: WebviewWindow, key: String, value: serde_json::Value) {
    let state = window_state(&window);
    if !state.set_ui(&key, value.clone()) {
        return;
    }
    let registry = app.state::<WindowRegistry>();
    let event = UiStateEvent {
        key,
        value,
        source: window.label().to_string(),
    };
    for label in registry.project_windows(window.label()) {
        if label == window.label() {
            continue;
        }
        let _ = app.emit_to(&label, "ui-state", event.clone());
    }
}
