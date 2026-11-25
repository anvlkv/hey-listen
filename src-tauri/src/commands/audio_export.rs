//! Audio-export IPC (M43): the adapter over [`crate::audio::export`] and the native
//! save dialog. The pipeline itself has no `tauri` types and is shared with the tests.

use serde::Deserialize;
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::audio::export::{
    self, AudioExportChannels, AudioExportDepth, AudioExportFormat, AudioExportRequest,
    ExportError, ExportedAudio,
};
use crate::audio::graph::GraphSpec;
use crate::state::window_state;

/// One `export_audio` request: where to write, which window of the source, and how to
/// shape and encode it.
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AudioExportArgs {
    pub path: String,
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub format: AudioExportFormat,
    #[serde(default)]
    pub depth: AudioExportDepth,
    #[serde(default)]
    pub channels: AudioExportChannels,
    /// The 0-based channel for `single`; ignored otherwise.
    #[serde(default)]
    pub channel: Option<usize>,
    /// Apply the composed filter graph, independent of the app's filter switch.
    #[serde(default)]
    pub apply_filter: bool,
    /// The composed filter spec (sent even while a frontend debounce is pending).
    #[serde(default)]
    pub filter: Option<GraphSpec>,
}

/// Export the analysis window of the project source to `args.path`.
///
/// Encoding is CPU-bound, so it runs on the blocking pool; the source lock is held only
/// across the slice, so a live capture keeps appending while a long file is written.
#[tauri::command]
pub async fn export_audio(
    window: WebviewWindow,
    args: AudioExportArgs,
) -> Result<ExportedAudio, ExportError> {
    let state = window_state(&window);
    tauri::async_runtime::spawn_blocking(move || {
        let request = AudioExportRequest {
            path: args.path,
            start: args.start,
            end: args.end,
            format: args.format,
            depth: args.depth,
            channels: args.channels,
            channel: args.channel,
            apply_filter: args.apply_filter,
            filter: args.filter,
        };
        let guard = state
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        export::export_source(guard.as_ref(), &request)
    })
    .await
    .map_err(|err| ExportError::Encode(err.to_string()))?
}

/// Pick where to write the exported audio, filtered to `format`'s extension.
#[tauri::command]
pub async fn pick_audio_export_path(
    app: AppHandle,
    format: AudioExportFormat,
    default_name: String,
) -> Option<String> {
    let (extension, label) = format.extension();
    app.dialog()
        .file()
        .set_title("Export audio")
        .add_filter(label, &[extension])
        .set_file_name(default_name)
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}
