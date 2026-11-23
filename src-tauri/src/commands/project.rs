//! Project file commands (M6).
//!
//! Thin adapters over [`crate::project`]: they own the IPC boundary (argument types,
//! `Channel`, dialogs, state) but keep the binary format in the engine. The core
//! owns the source PCM (ADR-9), so `save_project` reads it straight from
//! [`AudioState`] and `load_project` streams `DATA` back for the Timeline waveform
//! while handing the PCM to the core for preview/analysis.

use std::fs::File;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::audio::analysis::compare::SavedComparisonInfo;
use crate::audio::analyzers::AnalyzerId;
use crate::audio::STREAM_CHUNK_SAMPLES;
use crate::commands::stream;
use crate::project::{read_project, write_project_atomic, ProjectError, SaveProject};
use crate::state::{window_state, ProjectSnapshot};

pub mod open_paths;
pub mod results;
pub mod siblings;

/// macOS/iOS/Android deliver opens as URLs (`RunEvent::Opened`); Windows/Linux use
/// argv ([`opened_paths_from_args`]), so this helper is gated with its only caller.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub use open_paths::opened_paths_from_urls;
pub use open_paths::{handle_open_paths, opened_paths_from_args, OpenedFiles, OPEN_EVENT};
use results::{to_cached, to_stored};

/// The project's file extension (magic `HEYL`, and `bundle.fileAssociations` in
/// `tauri.conf.json`).
const PROJECT_EXTENSION: &str = "heyl";

/// One comparison open at save time (a compare tab or popout): its tool and its stable
/// pair id. Several comparisons may share a tool (M23 Phase 3).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CompareOpen {
    pub tool: AnalyzerId,
    pub id: String,
}

/// The request a save carries beyond the project content: everything here is **not**
/// undoable. The content itself (name, source, setup, layout, annotations) is the core's
/// [`ProjectSnapshot`] — the same one undo/redo records — so the file and history cannot
/// drift. `META`'s timestamps/version and the `DATA`
/// section (owned source PCM) are added by the core.
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SaveProjectRequest {
    /// Preserve the creation time when re-saving a loaded project; `None` = now.
    #[serde(default)]
    pub created_ms: Option<u64>,
    /// Embed the source PCM in `DATA` (default). `false` writes a **reference** project:
    /// the `SOURCE` descriptor keeps the file path and the loader decodes it again.
    #[serde(default = "embed_source_default")]
    pub embed_source: bool,
    /// The frontend's analyzer result cache (the file's `RESULTS` section — not undoable).
    #[serde(default)]
    pub results: Vec<results::CachedResultInput>,
    /// The comparisons open at save time (tabs or popouts, one entry per pair, M25.C).
    /// The core writes each one's last successful reference snapshot from its own state.
    #[serde(default)]
    pub compare_open: Vec<CompareOpen>,
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
    /// The project content as one projection (name, source, setup, layout, annotations).
    pub snapshot: ProjectSnapshot,
    /// Cached analyzer results (the frontend seeds its cache with them).
    pub results: Vec<results::CachedResultOutput>,
    /// Saved comparisons (compact; the full snapshots are installed in the core).
    pub compare: Vec<SavedComparisonInfo>,
    /// Whether the file embedded its audio (`DATA`).
    pub embedded: bool,
    /// The format version the file was migrated from, or `None`.
    pub upgraded_from: Option<u32>,
    /// The project's creation time (Unix ms).
    pub created_ms: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u64,
}

/// Write the current project to `path`: the core's snapshot plus its owned source PCM.
#[tauri::command]
pub async fn save_project(
    window: WebviewWindow,
    path: String,
    request: SaveProjectRequest,
) -> Result<(), ProjectError> {
    // Clone the project-state handle so the blocking write can snapshot the PCM without
    // borrowing the window.
    let state = window_state(&window);
    // The project content is the snapshot the frontend has been pushing (M24.A phase 2).
    let snapshot = state.project_snapshot();
    // One snapshot per comparison open at save time; a closed comparison is dropped.
    let open_ids: Vec<String> = request
        .compare_open
        .iter()
        .map(|comparison| comparison.id.clone())
        .collect();
    let compare = state.saved_comparisons_for(&open_ids);

    tauri::async_runtime::spawn_blocking(move || {
        // A reference project only makes sense for a file source: the loader can
        // decode the path again. Synths and live captures keep their audio.
        let reference = !request.embed_source
            && snapshot.source.as_ref().is_some_and(|source| {
                source.kind == crate::project::SourceKind::File && source.path.is_some()
            });
        // Snapshot the PCM under a **short** lock: the disk write must not hold it, or a
        // large save to slow storage stalls the capture appender (audit P2 #4).
        let pcm = if reference {
            None
        } else {
            state.audio.snapshot_source()
        };
        let save = SaveProject {
            name: snapshot.name,
            created_ms: request.created_ms,
            source: snapshot.source,
            setup: snapshot.setup,
            layout: snapshot.layout,
            results: to_stored(request.results),
            annotations: snapshot.annotations,
            compare,
            pcm: pcm.as_ref(),
        };
        // A script (MCP `save_project`) can target a folder that does not exist yet;
        // the helper creates it rather than failing at the last step of a long run.
        write_project_atomic(Path::new(&path), &save, crate::recent::now_ms())?;
        // The save succeeded, so a comparison no longer open can be forgotten.
        state.retain_saved_comparisons(&open_ids);
        // The file now holds the current format version, so a migrated project is no
        // longer dirty on that account (ADR-32 / M37).
        state.set_upgraded_from(None);
        Ok(())
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
    request_id: Option<u64>,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<LoadedProjectDto, ProjectError> {
    let state = window_state(&window);
    // Claim before the (long) read/decode so a newer source replacement supersedes this
    // load, and this load can never install over one that started later (audit P1 #2).
    let request = match request_id {
        Some(token) => state.audio.claim_source_request(token),
        None => Some(state.audio.claim_internal_source_request()),
    }
    .ok_or(ProjectError::Superseded)?;

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
        results: stored_results,
        annotations,
        compare,
        pcm,
        embedded,
        upgraded_from,
        ..
    } = loaded;

    // The project content travels as one projection; its `compare` stays empty because a
    // load's comparisons are the saved snapshots the compact field below restores.
    let created_ms = meta.created_ms;
    let snapshot = ProjectSnapshot {
        name: meta.name,
        source,
        setup,
        layout,
        annotations,
        compare: Vec::new(),
    };

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
        state.audio.install_source(request, Some(pcm));
    } else {
        state.audio.install_source(request, None);
    }

    // A load replaces the project's comparisons: the `COMPARE` snapshots become the
    // core's saved side, and the frontend restores a compare tab per entry (M25.C).
    let compare_infos: Vec<SavedComparisonInfo> =
        compare.iter().map(|saved| saved.info()).collect();
    window_state(&window).replace_saved_comparisons(compare);
    // A file from an older format version was migrated in memory; the project stays dirty
    // until a save writes the current one.
    window_state(&window).set_upgraded_from(upgraded_from);

    // End-of-stream sentinel (large chunks arrive asynchronously on the frontend).
    stream::send_end_sentinel(&on_chunk)
        .map_err(|err| ProjectError::Io(std::io::Error::other(err)))?;

    Ok(LoadedProjectDto {
        snapshot,
        results: to_cached(stored_results),
        compare: compare_infos,
        embedded,
        upgraded_from,
        created_ms,
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
