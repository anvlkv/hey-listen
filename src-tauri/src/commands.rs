//! Tauri IPC commands.
//!
//! The full command surface will live here (or in submodules under
//! `src-tauri/src/`), grouped by domain: source management, timeline, analysis,
//! and project files. See `docs/architecture.md` for the planned inventory.

/// Minimal health check used to verify the IPC boundary from the frontend shell.
#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}
