//! Project file commands (M6) — see `docs/project-file-format.md`.
//!
//! Thin adapters over [`crate::project`]: they own the IPC boundary (argument types,
//! `Channel`, dialogs, state) but keep the binary format in the engine. The core
//! owns the source PCM (ADR-9), so `save_project` reads it straight from
//! [`AudioState`] and `load_project` streams `DATA` back for the Timeline waveform
//! while handing the PCM to the core for preview/analysis.

use std::fs::File;
use std::io::BufWriter;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::audio::STREAM_CHUNK_SAMPLES;
use crate::commands::source::AUDIO_EXTENSIONS;
use crate::commands::{focused_label, stream};
use crate::project::{
    read_project, write_project, AnalysisSetup, Meta, Note, ProjectError, SaveProject,
    SourceDescriptor, StoredResult,
};
use crate::state::window_state;

/// The project's file extension (magic `HEYL`, and `bundle.fileAssociations` in
/// `tauri.conf.json`).
const PROJECT_EXTENSION: &str = "heyl";

/// The frontend-supplied project data for [`save_project`]; the core adds `META`
/// (timestamps/version) and the `DATA` section (owned source PCM).
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SaveProjectArgs {
    pub name: String,
    /// Preserve the creation time when re-saving a loaded project; `None` = now.
    #[serde(default)]
    pub created_ms: Option<u64>,
    pub source: Option<SourceDescriptor>,
    pub setup: AnalysisSetup,
    pub layout: serde_json::Value,
    /// The project's notes (M14).
    #[serde(default)]
    pub notes: Vec<Note>,
    /// Embed the source PCM in `DATA` (default). `false` writes a **reference**
    /// project: the `SOURCE` descriptor keeps the file path and the loader decodes it
    /// again. Useful when many annotation projects would otherwise duplicate audio.
    #[serde(default = "embed_source_default")]
    pub embed_source: bool,
}

fn embed_source_default() -> bool {
    true
}

/// What [`load_project`] returns. The `DATA` samples stream separately over the
/// command's `on_chunk` channel; the flat `sample_rate`/`channels`/`frames` let the
/// frontend rebuild its `AudioSource` without a second round-trip.
#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LoadedProjectDto {
    pub meta: Meta,
    pub source: Option<SourceDescriptor>,
    pub setup: AnalysisSetup,
    pub layout: serde_json::Value,
    /// Cached results (empty until result caching lands; readers tolerate this).
    pub results: Vec<StoredResult>,
    /// The project's notes (empty when the file has no `NOTES` section).
    pub notes: Vec<Note>,
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u64,
}

/// Write the current project to `path`: the frontend's setup/layout plus the
/// core-owned source PCM.
#[tauri::command]
pub async fn save_project(
    window: WebviewWindow,
    path: String,
    project: SaveProjectArgs,
) -> Result<(), ProjectError> {
    // Clone the `Arc` so the blocking write can lock the PCM without borrowing the state.
    let source = window_state(&window).audio.source.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let guard = source.lock().unwrap_or_else(|poison| poison.into_inner());
        // A reference project only makes sense for a file source: the loader can
        // decode the path again. Synths and live captures keep their audio.
        let reference = !project.embed_source
            && project
                .source
                .as_ref()
                .is_some_and(|source| source.kind == "file" && source.path.is_some());
        let save = SaveProject {
            name: project.name,
            created_ms: project.created_ms,
            source: project.source,
            setup: project.setup,
            layout: project.layout,
            results: Vec::new(),
            notes: project.notes,
            pcm: if reference { None } else { guard.as_ref() },
        };
        let file = File::create(&path)?;
        write_project(BufWriter::new(file), &save, crate::recent::now_ms())
    })
    .await
    .map_err(join_error)?
}

/// Read a project file, stream its `DATA` to the frontend, and install the audio as
/// the core's source (so preview and analysis work immediately).
#[tauri::command]
pub async fn load_project(
    window: WebviewWindow,
    path: String,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<LoadedProjectDto, ProjectError> {
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        let mut file = File::open(&path)?;
        let mut loaded = read_project(&mut file)?;
        // A reference project has no `DATA`; decode its file source in the same
        // blocking task (a long recording must not stall the async runtime).
        if loaded.pcm.is_none() {
            loaded.pcm = crate::project::decode_reference(loaded.source.as_ref());
        }
        Ok::<_, ProjectError>(loaded)
    })
    .await
    .map_err(join_error)??;

    let crate::project::LoadedProject {
        meta,
        source,
        setup,
        layout,
        results,
        notes,
        pcm,
        ..
    } = loaded;

    let (sample_rate, channels, frames) = match &pcm {
        Some(pcm) => {
            let channels = pcm.channels.max(1);
            (
                pcm.sample_rate,
                channels,
                (pcm.samples.len() / channels as usize) as u64,
            )
        }
        None => (0, 1, 0),
    };

    if let Some(pcm) = pcm {
        for chunk in pcm.samples.chunks(STREAM_CHUNK_SAMPLES) {
            stream::send_f32_chunk(&on_chunk, chunk)
                .map_err(|err| ProjectError::Io(std::io::Error::other(err)))?;
        }
        window_state(&window).audio.set_source(Some(pcm));
    } else {
        window_state(&window).audio.set_source(None);
    }

    // End-of-stream sentinel (large chunks arrive asynchronously on the frontend).
    stream::send_end_sentinel(&on_chunk)
        .map_err(|err| ProjectError::Io(std::io::Error::other(err)))?;

    Ok(LoadedProjectDto {
        meta,
        source,
        setup,
        layout,
        results,
        notes,
        sample_rate,
        channels,
        frames,
    })
}

/// Pick an existing project file to open (native dialog).
#[tauri::command]
pub async fn pick_project_open_path(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Open project")
        .add_filter("Hey Listen project", &[PROJECT_EXTENSION])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Pick where to save the project (native dialog), pre-filled with `default_name`.
#[tauri::command]
pub async fn pick_project_save_path(app: AppHandle, default_name: String) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Save project")
        .add_filter("Hey Listen project", &[PROJECT_EXTENSION])
        .set_file_name(default_name)
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

fn join_error(err: impl std::fmt::Display) -> ProjectError {
    ProjectError::Io(std::io::Error::other(err.to_string()))
}

// --- file associations / open-file requests ----------------------------------

/// Event carrying opened `.heyl` paths to a running frontend (file association).
pub const OPEN_EVENT: &str = "app:open-project";

/// `.heyl` paths requested before the frontend was ready (command line / macOS
/// `open`). Drained by [`take_pending_open_paths`] — once, by the first window.
#[derive(Default)]
pub struct OpenedFiles {
    pending: Mutex<Vec<String>>,
    /// Set once the first frontend has drained the queue, so later windows (a new
    /// project window) don't re-open paths that were already handled.
    drained: AtomicBool,
}

/// Paths the OS delivered before `setup` ran. macOS hands a cold-launched app the
/// open-documents Apple Event **before** `RunEvent::Ready` (which is when `setup`
/// manages [`OpenedFiles`]), so they cannot be queued in the managed state yet.
/// [`OpenedFiles::adopt_early`] drains this once the state exists.
static EARLY_OPEN_PATHS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Queue a path unless it is already queued (the OS may repeat a request).
fn queue_unique(queue: &mut Vec<String>, path: String) {
    if !queue.iter().any(|existing| existing == &path) {
        queue.push(path);
    }
}

impl OpenedFiles {
    fn queue(&self, path: String) {
        let mut guard = self
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        queue_unique(&mut guard, path);
    }

    /// Move paths that arrived before this state existed into the queue.
    pub fn adopt_early(&self) {
        let mut early = EARLY_OPEN_PATHS
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut guard = self
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        for path in early.drain(..) {
            queue_unique(&mut guard, path);
        }
    }

    fn take(&self) -> Vec<String> {
        if self.drained.swap(true, Ordering::SeqCst) {
            return Vec::new();
        }
        std::mem::take(
            &mut *self
                .pending
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()),
        )
    }
}

/// Drain the pending open-file requests (the frontend calls this on startup).
#[tauri::command]
pub fn take_pending_open_paths(state: State<'_, OpenedFiles>) -> Vec<String> {
    state.take()
}

/// Remember a project file as recently used and refresh the File → Open Recent menu.
///
/// Writes the recent list to disk and rebuilds the native menu; async so the file
/// write runs on the async runtime rather than the main thread (the menu rebuild
/// hops to the main thread itself).
#[tauri::command]
pub async fn add_recent_project(app: AppHandle, path: String) {
    crate::recent::record(&app, &path);
    let _ = crate::menu::rebuild(&app);
}

/// Queue file-open requests and notify a running frontend. Paths are queued so a
/// request that arrives before the frontend is listening is not lost; once windows
/// exist, the request is routed to the focused one (multi-window, M7).
pub fn handle_open_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    // Queue for the first frontend to drain (cold start / before any window listens).
    // On a cold launch the OS can deliver the request before `setup` manages this
    // state — `state()` would panic (and `panic = "abort"` turns that into SIGABRT),
    // so fall back to the process-level queue `setup` adopts.
    match app.try_state::<OpenedFiles>() {
        Some(state) => {
            for path in &paths {
                state.queue(path.clone());
            }
        }
        None => {
            let mut early = EARLY_OPEN_PATHS
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            for path in &paths {
                queue_unique(&mut early, path.clone());
            }
        }
    }
    // If a window already exists, also route the request to the focused one.
    if let Some(label) = focused_label(app) {
        let _ = app.emit_to(label, OPEN_EVENT, paths);
    }
}

/// `.heyl` or supported audio paths among command-line arguments (Windows/Linux
/// file association).
pub fn opened_paths_from_args(args: impl Iterator<Item = String>) -> Vec<String> {
    args.skip(1).filter(|arg| is_openable_path(arg)).collect()
}

/// `.heyl` / audio paths among macOS `open` URLs.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub fn opened_paths_from_urls(urls: Vec<tauri::Url>) -> Vec<String> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .filter(|path| is_openable_path(path))
        .collect()
}

/// A path the OS can ask us to open: a `.heyl` project or a supported audio file
/// (audio files open as a fresh project with that file as the source).
fn is_openable_path(path: &str) -> bool {
    has_extension(path, &[PROJECT_EXTENSION]) || has_extension(path, AUDIO_EXTENSIONS)
}

fn has_extension(path: &str, extensions: &[&str]) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| extensions.iter().any(|want| ext.eq_ignore_ascii_case(want)))
        .unwrap_or(false)
}
