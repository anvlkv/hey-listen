//! Source management commands.

use tauri_plugin_dialog::DialogExt;

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
