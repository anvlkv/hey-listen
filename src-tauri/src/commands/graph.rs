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
async fn render_mono(
    state: &Arc<WindowState>,
    spec: GraphSpec,
    seconds: f64,
    rate: u32,
) -> Result<Vec<f32>, GraphError> {
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
    rate: u32,
    on_chunk: &Channel<InvokeResponseBody>,
) -> Result<StreamSummary, GraphError> {
    stream_pcm(&pcm, on_chunk)?;
    let frames = pcm.len() as u64;
    let installed = state.audio.install_source(
        request,
        Some(SourceData {
            samples: pcm,
            sample_rate: rate,
            channels: 1,
        }),
    );
    if !installed {
        return Err(GraphError::Superseded);
    }
    Ok(StreamSummary {
        sample_rate: rate,
        channels: 1,
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
    let pcm = render_mono(&state, spec, seconds, rate).await?;
    install_rendered(&state, request, pcm, rate, on_chunk)
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
/// (channel mixdown → active filter) as mono PCM at the source sample rate, so the
/// Timeline can overlay the filtered signal on the raw waveform. Does not resample
/// (so frames align 1:1 with the raw waveform) and does not mutate the source.
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

    let mono = tauri::async_runtime::spawn_blocking(move || {
        crate::audio::analysis::condition(
            &samples,
            channels,
            sample_rate,
            filter.as_ref(),
            channel,
            None,
        )
        .map(|(mono, _rate)| mono)
        .map_err(|err| GraphError::Stream(err.to_string()))
    })
    .await
    .map_err(|err| GraphError::Stream(err.to_string()))??;

    stream_pcm(&mono, &on_chunk)?;

    Ok(StreamSummary {
        sample_rate,
        channels: 1,
        frames: mono.len() as u64,
    })
}
