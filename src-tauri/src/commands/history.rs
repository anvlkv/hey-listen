//! Undo/redo as a core project operation (M24.A, ADR-37).
//!
//! The core owns one project's [`ProjectSnapshot`] and its bounded stacks
//! ([`crate::state::history`]). The frontend pushes settled state
//! ([`push_project_state`]); undo and redo pop a step and broadcast the restore — the
//! changed `ui-state` keys ([`super::ui::broadcast_ui_patch`]) plus a dedicated
//! [`PROJECT_RESTORE_EVENT`] carrying the whole snapshot for the parts that are not
//! shared UI state (the graph editor specs and the dockview layout).

use std::collections::HashMap;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::state::{window_state, ProjectSnapshot, WindowRegistry, WindowState};

use super::ui::broadcast_ui_patch;

/// The event carrying the whole restored snapshot to every window of the project.
pub const PROJECT_RESTORE_EVENT: &str = "project-restore";

/// Record the project's current state (the frontend pushes it as it settles).
///
/// Nothing is broadcast about the state itself — the caller already has it. The core
/// fills `compare` (see [`WindowState::push_project_state`]) and the settle recorder turns
/// the snapshot into one undo step once it has been quiet.
#[tauri::command]
pub fn push_project_state(app: AppHandle, window: WebviewWindow, snapshot: ProjectSnapshot) {
    let label = root_label(&window);
    let state = window_state(&window);
    // The dirty tracker reports to the same project window the settle recorder does.
    state.arm_dirty(app.clone(), &label);
    state.arm_history(app, label);
    state.push_project_state(snapshot);
    state.broadcast_history();
}

/// Step back one edit, if there is one.
#[tauri::command]
pub fn undo(app: AppHandle, window: WebviewWindow) -> Option<ProjectSnapshot> {
    restore(&app, &window, true)
}

/// Step forward one undone edit, if there is one.
#[tauri::command]
pub fn redo(app: AppHandle, window: WebviewWindow) -> Option<ProjectSnapshot> {
    restore(&app, &window, false)
}

/// Whether undo would step somewhere (a freshly opened window pulls this on load).
#[tauri::command]
pub fn can_undo(window: WebviewWindow) -> bool {
    window_state(&window).can_undo()
}

/// Whether redo would step somewhere.
#[tauri::command]
pub fn can_redo(window: WebviewWindow) -> bool {
    window_state(&window).can_redo()
}

/// Drop the history and rebase it on the current state (New / Open / source change), so
/// undo can never step across a project boundary.
#[tauri::command]
pub fn reset_history(window: WebviewWindow) {
    let state = window_state(&window);
    state.reset_history();
    state.broadcast_history();
}

/// Pop a step and broadcast the restore to every window of the project.
fn restore(app: &AppHandle, window: &WebviewWindow, back: bool) -> Option<ProjectSnapshot> {
    let state = window_state(window);
    let snapshot = if back { state.undo() } else { state.redo() }?;
    broadcast_restore(app, window.label(), &state, &snapshot);
    state.broadcast_history();
    Some(snapshot)
}

/// The project (root) window label for `window`, so the recorder reports to the project
/// rather than to the popout that happened to be focused.
fn root_label(window: &WebviewWindow) -> String {
    window
        .app_handle()
        .state::<WindowRegistry>()
        .root_label(window.label())
}

fn broadcast_restore(
    app: &AppHandle,
    label: &str,
    state: &WindowState,
    snapshot: &ProjectSnapshot,
) {
    let registry = app.state::<WindowRegistry>();
    // The whole snapshot first: the graph editor specs and the layout are not shared UI
    // state, and a window applies them before the patches that follow.
    for window in registry.project_windows(label) {
        let _ = app.emit_to(&window, PROJECT_RESTORE_EVENT, snapshot.clone());
    }
    // Then the changed shared keys, so a window that only follows `ui-state`, and a
    // window opened later (which pulls the core's snapshot), land on the same values.
    let current = state.ui_snapshot();
    for (key, value) in changed_ui_keys(snapshot, &current) {
        let Some(revision) = state.set_ui(&key, value.clone()) else {
            continue;
        };
        broadcast_ui_patch(app, label, key, value, revision, label, true);
    }
}

/// The shared-UI keys a restore changes, diffed at the boundary the broadcast uses.
///
/// These are the keys `src/state/uiState.ts` registers; the rest of the snapshot rides
/// [`PROJECT_RESTORE_EVENT`].
fn changed_ui_keys(
    snapshot: &ProjectSnapshot,
    current: &HashMap<String, serde_json::Value>,
) -> Vec<(String, serde_json::Value)> {
    let mut changed: Vec<(String, serde_json::Value)> = Vec::new();
    let mut push = |key: &str, value: serde_json::Value| {
        if current.get(key) != Some(&value) {
            changed.push((key.to_string(), value));
        }
    };

    let setup = &snapshot.setup;
    push(
        "timeline",
        json!({
            "windowStart": setup.window.start_secs,
            "windowEnd": setup.window.end_secs,
            "viewStart": setup.view.start_secs,
            "viewEnd": setup.view.end_secs,
        }),
    );
    if let Some(value) = json_value(&setup.shared) {
        push("params", value);
    }
    if let Some(value) = json_value(&setup.tool_options) {
        push("toolOptions", value);
    }
    // `name` only: the snapshot deliberately does not carry the project's file path, which
    // the `project` key also holds, so the current one is preserved.
    let path = current
        .get("project")
        .and_then(|value| value.get("path"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    push("project", json!({ "name": snapshot.name, "path": path }));
    if let Some(value) = json_value(&snapshot.annotations) {
        push("annotations", value);
    }
    // The selection is not project content (so it is not undoable), but a restored set can
    // drop the annotation it pointed at — the key is cleared when it no longer exists.
    let selected = current
        .get("selectedAnnotationId")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    if let Some(selected) = selected {
        let still_present = snapshot
            .annotations
            .iter()
            .any(|annotation| annotation.id == selected);
        if !still_present {
            push("selectedAnnotationId", serde_json::Value::Null);
        }
    }

    changed
}

/// A value's JSON form (`None` when it cannot be serialized, which no snapshot field is).
fn json_value<T: Serialize>(value: &T) -> Option<serde_json::Value> {
    serde_json::to_value(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What a first restore would emit, as the core then stores it.
    fn stored(snapshot: &ProjectSnapshot) -> HashMap<String, serde_json::Value> {
        changed_ui_keys(snapshot, &HashMap::new())
            .into_iter()
            .collect()
    }

    #[test]
    fn an_unchanged_restore_broadcasts_nothing() {
        let snapshot = ProjectSnapshot {
            name: "song".into(),
            ..ProjectSnapshot::default()
        };
        assert!(changed_ui_keys(&snapshot, &stored(&snapshot)).is_empty());
    }

    #[test]
    fn only_the_keys_that_changed_are_broadcast() {
        let before = ProjectSnapshot {
            name: "song".into(),
            ..ProjectSnapshot::default()
        };
        let current = stored(&before);

        let mut after = before.clone();
        after.name = "song 2".into();
        after.setup.window.end_secs = 12.0;
        let keys: Vec<String> = changed_ui_keys(&after, &current)
            .into_iter()
            .map(|(key, _)| key)
            .collect();
        assert_eq!(keys, ["timeline", "project"]);
    }

    #[test]
    fn the_file_path_survives_a_restore() {
        let snapshot = ProjectSnapshot {
            name: "song".into(),
            ..ProjectSnapshot::default()
        };
        let mut current = HashMap::new();
        current.insert(
            "project".to_string(),
            json!({ "name": "old", "path": "/tmp/song.heyl" }),
        );

        let changed = changed_ui_keys(&snapshot, &current);
        let (_, value) = changed
            .iter()
            .find(|(key, _)| key == "project")
            .expect("the project key changed");
        assert_eq!(value["path"], json!("/tmp/song.heyl"));
        assert_eq!(value["name"], json!("song"));
    }

    #[test]
    fn a_selection_whose_annotation_vanished_is_cleared() {
        let snapshot = ProjectSnapshot::default();
        let mut current = stored(&snapshot);
        current.insert("selectedAnnotationId".to_string(), json!("gone"));

        assert_eq!(
            changed_ui_keys(&snapshot, &current),
            vec![("selectedAnnotationId".to_string(), serde_json::Value::Null)]
        );
    }
}
