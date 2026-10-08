//! Source management commands.

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::audio::capture::{CAPTURE_CHANNELS, CAPTURE_RATE};
use crate::state::AudioState;

/// File extensions we advertise in the open dialog (all decodable via
/// symphonia's `all` feature set).
const AUDIO_EXTENSIONS: &[&str] = &[
    "wav", "wave", "flac", "mp3", "m4a", "mp4", "aac", "ogg", "oga", "opus", "aiff", "aif", "aifc",
    "caf", "alac", "mkv", "webm",
];

/// Open a native file picker and return the chosen audio file's path, or `None`
/// if the user cancelled.
///
/// The Rust core owns file I/O (see `docs/architecture.md`), so the frontend
/// receives a path and lets the backend open/decode the file.
#[tauri::command]
pub async fn pick_audio_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Open audio file")
        .add_filter("Audio", AUDIO_EXTENSIONS)
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Drop the core-owned source PCM and silence preview (the timeline is changing).
#[tauri::command]
pub fn clear_audio_source(app: AppHandle) {
    app.state::<AudioState>().clear();
}

/// Start a fresh core recording buffer at Record; only the audio after this point
/// is kept (the frontend does the same with its own copy).
#[tauri::command]
pub fn begin_capture_source(app: AppHandle) {
    app.state::<AudioState>()
        .begin_recording(CAPTURE_RATE, CAPTURE_CHANNELS);
}

/// Stop appending capture chunks; the recorded audio stays in the core.
#[tauri::command]
pub fn end_capture_source(app: AppHandle) {
    app.state::<AudioState>().end_recording();
}
