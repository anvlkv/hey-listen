//! Source management commands.

use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::audio::capture::{CAPTURE_CHANNELS, CAPTURE_RATE};
use crate::state::window_state;

/// File extensions we advertise in the open dialog and accept as OS-open requests
/// (all decodable via symphonia's `all` feature set).
pub const AUDIO_EXTENSIONS: &[&str] = &[
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

/// Show a native OK/Cancel confirmation dialog and return `true` only if the user
/// confirms.
///
/// The frontend has no dialog package and `window.confirm` is unreliable in the
/// WebView, so the replace-source / discard-unsaved-work prompts go through the
/// core. The `pick_audio_file` pattern is reused (a blocking dialog on the async
/// runtime, never on the main thread).
#[tauri::command]
pub async fn confirm(app: AppHandle, message: String, title: String) -> bool {
    app.dialog()
        .message(message)
        .title(title)
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show()
}

/// Force-close the window that invoked this command.
///
/// The frontend's `onCloseRequested` guard always prevents the native close (the JS
/// helper would otherwise `destroy()` the window itself, which needs a window
/// permission this app does not grant) and routes the real close through here.
/// `destroy` (rather than `close`) does not re-emit the close-requested event, so the
/// guard cannot loop.
#[tauri::command]
pub async fn close_window(window: tauri::WebviewWindow) {
    let _ = window.destroy();
}

/// Drop the core-owned source PCM and silence preview (the timeline is changing).
#[tauri::command]
pub fn clear_audio_source(window: WebviewWindow) {
    window_state(&window).audio.clear();
}

/// Start a fresh core recording buffer at Record; only the audio after this point
/// is kept (the frontend does the same with its own copy).
#[tauri::command]
pub fn begin_capture_source(window: WebviewWindow) {
    window_state(&window)
        .audio
        .begin_recording(CAPTURE_RATE, CAPTURE_CHANNELS);
}

/// Stop appending capture chunks; the recorded audio stays in the core.
#[tauri::command]
pub fn end_capture_source(window: WebviewWindow) {
    window_state(&window).audio.end_recording();
}

/// The shared source's shape, for a popout window to render a tool against the
/// parent's project without loading the PCM into the frontend.
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SharedSourceInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: usize,
    pub duration: f64,
}

/// Errors produced while resolving a window's shared source.
#[derive(Debug, thiserror::Error)]
pub enum SourceError {
    #[error("no source loaded")]
    NoSource,
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(SourceError);

#[tauri::command]
pub fn load_shared_source(window: WebviewWindow) -> Result<SharedSourceInfo, SourceError> {
    let state = window_state(&window);
    let guard = state
        .audio
        .source
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let source = guard.as_ref().ok_or(SourceError::NoSource)?;
    let channels = source.channels.max(1) as usize;
    let frames = source.samples.len() / channels;
    let sample_rate = source.sample_rate.max(1);
    Ok(SharedSourceInfo {
        sample_rate,
        channels: source.channels.max(1),
        frames,
        duration: frames as f64 / f64::from(sample_rate),
    })
}
