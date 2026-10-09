//! Tauri IPC commands, grouped by domain.
//!
//! Commands are thin adapters over the engines in [`crate::audio`]: they own the
//! IPC boundary (argument/return types, `Channel`s) but keep the audio work in
//! the engine modules. See `docs/architecture.md` for the planned inventory.

pub mod analysis;
pub mod capture;
pub mod decode;
pub mod graph;
pub mod playback;
pub mod project;
pub mod source;

/// Minimal health check used to verify the IPC boundary from the frontend shell.
#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}
