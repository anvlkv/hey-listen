//! Project file commands (M6) — see `docs/project-file-format.md`.
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
use crate::project::{
    read_project, write_project_atomic, AnalysisSetup, Annotation, Meta, ProjectError, SaveProject,
    SourceDescriptor,
};
use crate::state::window_state;

pub mod open_paths;
pub mod results;
pub mod siblings;

pub use open_paths::{
    handle_open_paths, opened_paths_from_args, opened_paths_from_urls, OpenedFiles, OPEN_EVENT,
};
use results::{to_cached, to_stored};

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
    /// The project's annotations (M14).
    #[serde(default)]
    pub annotations: Vec<Annotation>,
    /// Embed the source PCM in `DATA` (default). `false` writes a **reference**
    /// project: the `SOURCE` descriptor keeps the file path and the loader decodes it
    /// again. Useful when many annotation projects would otherwise duplicate audio.
    #[serde(default = "embed_source_default")]
    pub embed_source: bool,
    /// The comparison tools open at save time (tabs or popouts, M25.C). The core
    /// writes each one's last successful reference snapshot from its own state.
    #[serde(default)]
    pub compare_open: Vec<AnalyzerId>,
    /// The frontend's analyzer result cache (one entry per tool), written as `RESULTS`.
    #[serde(default)]
    pub results: Vec<results::CachedResultInput>,
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
    /// The cached analyzer results, restored into the frontend's result cache.
    pub results: Vec<results::CachedResultOutput>,
    /// The project's annotations (empty when the file has no `NOTES` section).
    pub annotations: Vec<Annotation>,
    /// Saved comparisons (empty when the file has no `COMPARE` section).
    pub compare: Vec<SavedComparisonInfo>,
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
    // Clone the project-state handle so the blocking write can snapshot the PCM without
    // borrowing the window.
    let state = window_state(&window);
    // One snapshot per comparison open at save time; a closed comparison is dropped.
    let compare_open = project.compare_open.clone();
    let compare = state.saved_comparisons_for(&compare_open);

    tauri::async_runtime::spawn_blocking(move || {
        // A reference project only makes sense for a file source: the loader can
        // decode the path again. Synths and live captures keep their audio.
        let reference = !project.embed_source
            && project.source.as_ref().is_some_and(|source| {
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
            name: project.name,
            created_ms: project.created_ms,
            source: project.source,
            setup: project.setup,
            layout: project.layout,
            results: to_stored(project.results),
            annotations: project.annotations,
            compare,
            pcm: pcm.as_ref(),
        };
        // A script (MCP `save_project`) can target a folder that does not exist yet;
        // the helper creates it rather than failing at the last step of a long run.
        write_project_atomic(Path::new(&path), &save, crate::recent::now_ms())?;
        // The save succeeded, so a comparison no longer open can be forgotten.
        state.retain_saved_comparisons(&compare_open);
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
        state.audio.install_source(request, Some(pcm));
    } else {
        state.audio.install_source(request, None);
    }

    // A load replaces the project's comparisons: the `COMPARE` snapshots become the
    // core's saved side, and the frontend restores a compare tab per entry (M25.C).
    let compare_infos: Vec<SavedComparisonInfo> =
        compare.iter().map(|saved| saved.info()).collect();
    window_state(&window).replace_saved_comparisons(compare);

    // End-of-stream sentinel (large chunks arrive asynchronously on the frontend).
    stream::send_end_sentinel(&on_chunk)
        .map_err(|err| ProjectError::Io(std::io::Error::other(err)))?;

    Ok(LoadedProjectDto {
        meta,
        source,
        setup,
        layout,
        results: to_cached(stored_results),
        annotations,
        compare: compare_infos,
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
