//! Filter/synth graph commands.
//!
//! Thin adapters over [`crate::audio::graph`]: they own the IPC boundary (argument
//! types, `Channel`, state) but keep the fundsp work in the engine.
//!
//! The synth has two render paths (ADR-21 / M22): **Render once** ([`render_synth`])
//! which defines (or replaces) the source, and **Live** ([`update_synth_source`]) which
//! overwrites the synth source in place as the graph is edited.

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::WebviewWindow;

use crate::audio::decode::StreamSummary;
use crate::audio::graph::{self, GraphError, GraphSpec};
use crate::audio::STREAM_CHUNK_SAMPLES;
use crate::commands::stream;
use crate::state::{window_state, SourceData, SourceRequest, WindowState};

/// Source renders are clamped to the same range as `render_synth`.
const SOURCE_MIN_SECONDS: f64 = 0.01;
const SOURCE_MAX_SECONDS: f64 = 600.0;

/// Render a synth graph on the blocking pool through the window's compiled net.
///
/// Compiling and rendering are CPU-bound, so they never run on the async runtime, and a
/// parameter-only edit patches the net in place instead of recompiling it (`SynthSession`).
/// Returns interleaved PCM and its channel count (a graph may declare several channels).
async fn render_pcm(
    state: &Arc<WindowState>,
    spec: GraphSpec,
    seconds: f64,
    rate: u32,
) -> Result<(Vec<f32>, usize), GraphError> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut synth = state
            .audio
            .synth
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        synth.render(&spec, seconds, rate)
    })
    .await
    .map_err(|err| GraphError::Stream(err.to_string()))?
}

/// Stream mono PCM and its end-of-stream sentinel to the frontend.
fn stream_pcm(pcm: &[f32], channel: &Channel<InvokeResponseBody>) -> Result<(), GraphError> {
    for chunk in pcm.chunks(STREAM_CHUNK_SAMPLES) {
        stream::send_f32_chunk(channel, chunk).map_err(GraphError::Stream)?;
    }
    stream::send_end_sentinel(channel).map_err(GraphError::Stream)
}

/// Stream a rendered buffer and install it as the source under `request`.
fn install_rendered(
    state: &WindowState,
    request: SourceRequest,
    pcm: Vec<f32>,
    channels: u16,
    rate: u32,
    on_chunk: &Channel<InvokeResponseBody>,
) -> Result<StreamSummary, GraphError> {
    let channels = channels.max(1);
    // The buffer is interleaved, so the frame count is its length over the channel count.
    let frames = (pcm.len() / usize::from(channels)) as u64;
    stream_pcm(&pcm, on_chunk)?;
    let installed = state.audio.install_source(
        request,
        Some(SourceData {
            samples: pcm,
            sample_rate: rate,
            channels,
        }),
    );
    if !installed {
        return Err(GraphError::Superseded);
    }
    Ok(StreamSummary {
        sample_rate: rate,
        channels,
        frames,
    })
}

/// Render a synth graph and adopt it as the source (Render once / Live source write).
async fn render_source(
    window: &WebviewWindow,
    spec: GraphSpec,
    seconds: f64,
    sample_rate: u32,
    request_id: u64,
    on_chunk: &Channel<InvokeResponseBody>,
) -> Result<StreamSummary, GraphError> {
    let rate = sample_rate.clamp(8_000, 192_000);
    let seconds = seconds.clamp(SOURCE_MIN_SECONDS, SOURCE_MAX_SECONDS);
    let state = window_state(window);
    let Some(request) = state.audio.claim_source_request(request_id) else {
        return Err(GraphError::Superseded);
    };
    let (pcm, channels) = render_pcm(&state, spec, seconds, rate).await?;
    install_rendered(&state, request, pcm, channels as u16, rate, on_chunk)
}

/// Install (or clear) the project's filter graph. Validated as a filter (one
/// global input); an invalid graph clears the filter and surfaces the error.
///
/// Building the fundsp graph is CPU-bound, so it runs on the blocking pool rather
/// than the main thread (synchronous commands run on the main thread).
#[tauri::command]
pub async fn set_filter_graph(
    window: WebviewWindow,
    spec: Option<GraphSpec>,
) -> Result<(), GraphError> {
    let state = window_state(&window);
    let spec = match spec {
        None => {
            state.audio.set_filter(None);
            return Ok(());
        }
        Some(spec) if spec.is_empty() => {
            state.audio.set_filter(None);
            return Ok(());
        }
        Some(spec) => spec,
    };

    let to_build = spec.clone();
    let built = tauri::async_runtime::spawn_blocking(move || {
        graph::build(&to_build, 1, 48_000).map(|_| ())
    })
    .await
    .map_err(|err| GraphError::Stream(err.to_string()))?;

    if let Err(err) = built {
        state.audio.set_filter(None);
        return Err(err);
    }
    state.audio.set_filter(Some(spec));
    Ok(())
}

/// Build a fundsp synth graph, render it to mono PCM, stream it to the frontend,
/// and adopt it as the project source. `request_id` is the frontend's source token:
/// the render is installed only while it is still the newest replacement.
#[tauri::command]
pub async fn render_synth(
    window: WebviewWindow,
    spec: GraphSpec,
    seconds: f64,
    sample_rate: u32,
    request_id: u64,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<StreamSummary, GraphError> {
    render_source(&window, spec, seconds, sample_rate, request_id, &on_chunk).await
}

/// **Live** source write: render the requested length and overwrite the synth source
/// **in place**, streaming the PCM to the frontend. The frontend keeps its analysis
/// window, view and annotations; only the audio under them changes (ADR-21).
#[tauri::command]
pub async fn update_synth_source(
    window: WebviewWindow,
    spec: GraphSpec,
    seconds: f64,
    sample_rate: u32,
    request_id: u64,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<StreamSummary, GraphError> {
    render_source(&window, spec, seconds, sample_rate, request_id, &on_chunk).await
}

/// Stream the **whole** source conditioned exactly like preview/analysis
/// (channel mixdown → active filter) as interleaved PCM at the source sample rate, so
/// the Timeline can draw the filtered signal. Every filter output channel is rendered
/// (the summary's `channels` says how many), so a graph that splits the input into
/// several branches shows one lane per branch. Does not resample (so frames align 1:1
/// with the raw waveform) and does not mutate the source.
#[tauri::command]
pub async fn render_filtered(
    window: WebviewWindow,
    channel: Option<usize>,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<StreamSummary, GraphError> {
    // Snapshot the source PCM and the active filter under the lock, then release it
    // before the CPU-bound conditioning runs on the blocking pool (the guard is not
    // `Send`). The source is left untouched — this only reads it.
    let (samples, channels, sample_rate, filter) = {
        let state = window_state(&window);
        let guard = state
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let source = guard
            .as_ref()
            .ok_or_else(|| GraphError::Stream("no source".into()))?;

        let filter = state
            .audio
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone();

        (
            source.samples.clone(),
            source.channels.max(1),
            source.sample_rate.max(1),
            filter,
        )
    };

    let (pcm, outputs) = tauri::async_runtime::spawn_blocking(move || {
        // The filter net's global input is mono: mix the selected source channel (or all
        // of them) down first, then render every output channel the graph declares.
        let mono = crate::audio::pcm::mixdown(&samples, usize::from(channels), channel);
        match filter.as_ref() {
            Some(spec) => graph::apply_channels(spec, &mono, sample_rate),
            None => Ok((mono, 1)),
        }
        .map_err(|err| GraphError::Stream(err.to_string()))
    })
    .await
    .map_err(|err| GraphError::Stream(err.to_string()))??;

    stream_pcm(&pcm, &on_chunk)?;

    let outputs = outputs.max(1);
    Ok(StreamSummary {
        sample_rate,
        channels: outputs as u16,
        frames: (pcm.len() / outputs) as u64,
    })
}

// --- DOT interchange (M39, ADR-36) -----------------------------------------

/// Emit a graph spec as DOT (the canonical text form).
#[tauri::command]
pub fn graph_dot(spec: GraphSpec) -> Result<String, GraphError> {
    graph::emit(&spec)
}

/// Parse inline DOT (or a file path) into a spec. Used by the MCP bridge's
/// `set_filter_graph` / `render_synth`.
#[tauri::command]
pub fn graph_from_dot(dot: String) -> Result<GraphSpec, GraphError> {
    graph::parse_input(&dot)
}

/// Read a `.dot` / `.gv` file (or a legacy JSON graph) into a spec.
#[tauri::command]
pub fn graph_read_file(path: String) -> Result<GraphSpec, GraphError> {
    graph::parse_input(&path)
}

/// Write a graph spec to a `.dot` file.
#[tauri::command]
pub fn graph_write_dot(spec: GraphSpec, path: String) -> Result<(), GraphError> {
    let text = graph::emit(&spec)?;
    std::fs::write(&path, text)
        .map_err(|err| GraphError::Stream(format!("cannot write {path}: {err}")))
}

/// One node kind's catalog entry plus its DOT skeleton (`get_node`).
#[tauri::command]
pub fn graph_node_detail(kind: String) -> Result<serde_json::Value, GraphError> {
    graph::detail_json(&kind).ok_or(GraphError::UnknownKind(kind))
}

/// The latest samples a `snoop` node saw (its compact on-node waveform).
///
/// `scope` is `filter`, `synth`, or a subsystem path (`filter/feedback-3`), the same
/// scope the compiler registered the node under.
#[tauri::command]
pub fn graph_snoop(scope: String, node: String, points: Option<usize>) -> graph::SnoopView {
    graph::snoop_read(&scope, &node, points.unwrap_or(96))
}

/// Pick a `.dot` / `.gv` graph file to import.
#[tauri::command]
pub async fn pick_graph_file(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Import graph")
        .add_filter("Graphviz DOT", &["dot", "gv"])
        .add_filter("JSON graph (legacy)", &["json"])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Pick a text file of table rows to import (the dialog only; the reader is
/// [`read_table_file`], so a test can stub the dialog and still exercise parsing).
#[tauri::command]
pub async fn pick_table_file(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Load table rows")
        .add_filter("Table rows", &["txt", "csv", "tsv"])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// The catalog's variadic table for `kind`, or an error when the kind has none.
fn table_def(kind: &str) -> Result<&'static graph::NodeTable, GraphError> {
    graph::node_def(kind)
        .and_then(|def| def.table)
        .ok_or_else(|| GraphError::NoTable(kind.to_string()))
}

/// Read table rows from a text file: one row per line, as many values as the kind's
/// table has columns. Returns the rows row-major, ready to store on the node.
#[tauri::command]
pub fn read_table_file(kind: String, path: String) -> Result<Vec<f32>, GraphError> {
    let table = table_def(&kind)?;
    let text = std::fs::read_to_string(&path)
        .map_err(|err| GraphError::Io(format!("cannot read {path}: {err}")))?;
    let rows = graph::parse_table_text(&text, table.columns.len());
    if rows.is_empty() {
        return Err(GraphError::Io(format!(
            "{path} holds no table rows (expected numbers, one row per line)"
        )));
    }
    Ok(rows)
}

/// Write table rows to a text file: a header of the catalog's column labels, then one
/// row per line.
#[tauri::command]
pub fn write_table_file(kind: String, rows: Vec<f32>, path: String) -> Result<(), GraphError> {
    let table = table_def(&kind)?;
    let width = table.columns.len().max(1);
    let header: Vec<String> = table
        .columns
        .iter()
        .map(|column| column.label.to_lowercase())
        .collect();
    let mut text = header.join(",");
    text.push('\n');
    for row in rows.chunks(width) {
        let values: Vec<String> = row.iter().map(|value| value.to_string()).collect();
        text.push_str(&values.join(","));
        text.push('\n');
    }
    std::fs::write(&path, text).map_err(|err| GraphError::Io(format!("cannot write {path}: {err}")))
}
