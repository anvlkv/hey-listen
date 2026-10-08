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
