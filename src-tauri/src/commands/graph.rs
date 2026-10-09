//! Filter/synth graph commands.
//!
//! Thin adapters over [`crate::audio::graph`]: they own the IPC boundary (argument
//! types, `Channel`, state) but keep the fundsp work in the engine.

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager};

use crate::audio::decode::StreamSummary;
use crate::audio::graph::{self, GraphError, GraphSpec};
use crate::state::{AudioState, SourcePcm};

/// Interleaved samples per streamed chunk from a rendered synth (256 KiB).
const RENDER_CHUNK: usize = 64 * 1024;

/// Install (or clear) the project's filter graph. Validated as a filter (one
/// global input); an invalid graph clears the filter and surfaces the error.
#[tauri::command]
pub fn set_filter_graph(app: AppHandle, spec: Option<GraphSpec>) -> Result<(), GraphError> {
    let state = app.state::<AudioState>();
    match spec {
        None => {
            state.set_filter(None);
            Ok(())
        }
        Some(spec) if spec.is_empty() => {
            state.set_filter(None);
            Ok(())
        }
        Some(spec) => {
            if let Err(err) = graph::build(&spec, 1, 48_000) {
                state.set_filter(None);
                return Err(err);
            }
            state.set_filter(Some(spec));
            Ok(())
        }
    }
}

/// Build a fundsp synth graph, render it to mono PCM, stream it to the frontend,
/// and adopt it as the project source.
#[tauri::command]
pub async fn render_synth(
    app: AppHandle,
    spec: GraphSpec,
    seconds: f64,
    sample_rate: u32,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<StreamSummary, GraphError> {
    let rate = sample_rate.clamp(8_000, 192_000);
    let seconds = seconds.clamp(0.01, 600.0);

    let pcm =
        tauri::async_runtime::spawn_blocking(move || graph::render_mono(&spec, seconds, rate))
            .await
            .map_err(|err| GraphError::Stream(err.to_string()))??;

    for chunk in pcm.chunks(RENDER_CHUNK) {
        let mut bytes = Vec::with_capacity(chunk.len() * 4);
        for sample in chunk {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        on_chunk
            .send(InvokeResponseBody::Raw(bytes))
            .map_err(|err| GraphError::Stream(err.to_string()))?;
    }

    // End-of-stream sentinel (large chunks arrive asynchronously on the frontend).
    on_chunk
        .send(InvokeResponseBody::Raw(Vec::new()))
        .map_err(|err| GraphError::Stream(err.to_string()))?;

    let frames = pcm.len() as u64;
    app.state::<AudioState>().set_source(Some(SourcePcm {
        samples: pcm,
        sample_rate: rate,
        channels: 1,
    }));

    Ok(StreamSummary {
        sample_rate: rate,
        channels: 1,
        frames,
    })
}

/// Stream the **whole** source conditioned exactly like preview/analysis
/// (channel mixdown → active filter) as mono PCM at the source sample rate, so the
/// Timeline can overlay the filtered signal on the raw waveform. Does not resample
/// (so frames align 1:1 with the raw waveform) and does not mutate the source.
#[tauri::command]
pub async fn render_filtered(
    app: AppHandle,
    channel: Option<usize>,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<StreamSummary, GraphError> {
    // Snapshot the source PCM and the active filter under the lock, then release it
    // before the CPU-bound conditioning runs on the blocking pool (the guard is not
    // `Send`). The source is left untouched — this only reads it.
    let (samples, channels, sample_rate, filter) = {
        let state = app.state::<AudioState>();
        let guard = state
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let source = guard
            .as_ref()
            .ok_or_else(|| GraphError::Stream("no source".into()))?;

        let filter = state
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

    for chunk in mono.chunks(RENDER_CHUNK) {
        let mut bytes = Vec::with_capacity(chunk.len() * 4);
        for sample in chunk {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        on_chunk
            .send(InvokeResponseBody::Raw(bytes))
            .map_err(|err| GraphError::Stream(err.to_string()))?;
    }

    // End-of-stream sentinel (large chunks arrive asynchronously on the frontend).
    on_chunk
        .send(InvokeResponseBody::Raw(Vec::new()))
        .map_err(|err| GraphError::Stream(err.to_string()))?;

    Ok(StreamSummary {
        sample_rate,
        channels: 1,
        frames: mono.len() as u64,
    })
}
