//! Unsaved-work commands (M24.A phase 3).
//!
//! The core owns the dirty flag ([`crate::state::ProjectDirty`]): it compares the project
//! snapshot the frontend pushes with the last clean point and broadcasts `project-dirty`
//! whenever the answer changes (see `state/window/dirty.rs`). These commands are the pulls
//! a freshly opened window makes and the save/load/new lifecycle calls.

use tauri::{AppHandle, WebviewWindow};

use crate::state::window_state;

/// Whether there are unsaved edits. Recomputes first, so an unsaved-work guard that runs
/// right after a push cannot read the flag from before that push.
#[tauri::command]
pub fn is_dirty(window: WebviewWindow) -> bool {
    window_state(&window).dirty_now()
}

/// Whether the project has nothing worth protecting (no source, no annotations, both
/// graphs still seeded) — a discard prompt would be noise.
#[tauri::command]
pub fn is_empty_project(window: WebviewWindow) -> bool {
    window_state(&window).is_empty_project()
}

/// Take the current state as the clean point (after a save wrote it).
#[tauri::command]
pub fn mark_project_clean(app: AppHandle, window: WebviewWindow) {
    let state = window_state(&window);
    state.arm_dirty(app, window.label());
    state.mark_clean();
}

/// Suppress dirty tracking while a load/new restores state.
#[tauri::command]
pub fn begin_project_baseline(app: AppHandle, window: WebviewWindow) {
    let state = window_state(&window);
    state.arm_dirty(app, window.label());
    state.begin_baseline();
}

/// Re-arm the baseline: the restored state becomes clean once it has settled.
#[tauri::command]
pub fn end_project_baseline(app: AppHandle, window: WebviewWindow) {
    let state = window_state(&window);
    state.arm_dirty(app, window.label());
    state.end_baseline();
}
