//! Decode/file-source commands.

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager};

use crate::audio::decode::{self, DecodeError, ProbeInfo, StreamSummary};
use crate::state::{AudioState, SourcePcm};

/// Inspect a file's container/codec metadata (codec, sample rate, channels,
/// duration) without decoding it.
#[tauri::command]
pub fn probe_file(path: String) -> Result<ProbeInfo, DecodeError> {
    decode::probe(&path)
}

/// Decode a file and stream interleaved `f32` PCM to the frontend as raw bytes
/// (little-endian) over an ordered [`Channel`].
///
/// The decoded PCM is also retained by the core as the project source (ADR-9), so
/// preview playback does not need it sent back from the frontend. The CPU-bound
/// decode runs on the blocking pool so the async workers stay free for
/// capture/decode, per `docs/architecture.md` → "Threading".
#[tauri::command]
pub async fn stream_file(
    app: AppHandle,
    path: String,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<StreamSummary, DecodeError> {
    // End-of-stream sentinel: large chunks are delivered asynchronously, so the
    // frontend must not assume the last one arrived when this command returns.
    let sentinel = on_chunk.clone();
    let (summary, samples) = tauri::async_runtime::spawn_blocking(move || {
        let mut samples: Vec<f32> = Vec::new();
        let summary = decode::decode_file(&path, |decoded| {
            samples.extend_from_slice(decoded);
            let mut bytes = Vec::with_capacity(std::mem::size_of_val(decoded));
            for sample in decoded {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
            on_chunk
                .send(InvokeResponseBody::Raw(bytes))
                .map_err(|err| DecodeError::Decode(err.to_string()))
        })?;
        Ok::<_, DecodeError>((summary, samples))
    })
    .await
    .map_err(|err| DecodeError::Decode(err.to_string()))??;

    app.state::<AudioState>().set_source(Some(SourcePcm {
        samples,
        sample_rate: summary.sample_rate,
        channels: summary.channels,
    }));

    sentinel
        .send(InvokeResponseBody::Raw(Vec::new()))
        .map_err(|err| DecodeError::Decode(err.to_string()))?;

    Ok(summary)
}
