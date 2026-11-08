//! Decode/file-source commands.

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::WebviewWindow;

use crate::audio::decode::{self, DecodeError, ProbeInfo, StreamSummary};
use crate::commands::stream;
use crate::state::{window_state, SourceData};

/// Inspect a file's container/codec metadata (codec, sample rate, channels,
/// duration) without decoding it.
///
/// Reading the header goes through symphonia (disk I/O + demux), so it runs on the
/// blocking pool rather than the main thread (synchronous commands run on the main
/// thread).
#[tauri::command]
pub async fn probe_file(path: String) -> Result<ProbeInfo, DecodeError> {
    tauri::async_runtime::spawn_blocking(move || decode::probe(&path))
        .await
        .map_err(|err| DecodeError::Decode(err.to_string()))?
}

/// Decode a file and stream interleaved `f32` PCM to the frontend as raw bytes
/// (little-endian) over an ordered [`Channel`].
///
/// The decoded PCM is also retained by the core as the project source (ADR-9), so
/// preview playback does not need it sent back from the frontend. The CPU-bound
/// decode runs on the blocking pool so the async workers stay free for
/// capture/decode, per `docs/architecture.md` → "Threading".
///
/// `request_id` is the frontend's monotonic open token. The request is claimed before the
/// decode starts and installed only if it is still the newest when it finishes, so an
/// out-of-order completion cannot leave playback/analysis reading a different source
/// than the timeline shows (audit P1 #2).
#[tauri::command]
pub async fn stream_file(
    window: WebviewWindow,
    path: String,
    request_id: u64,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<StreamSummary, DecodeError> {
    let state = window_state(&window);
    let Some(request) = state.audio.claim_source_request(request_id) else {
        return Err(DecodeError::Superseded);
    };
    // End-of-stream sentinel: large chunks are delivered asynchronously, so the
    // frontend must not assume the last one arrived when this command returns.
    let sentinel = on_chunk.clone();
    let (summary, samples) = tauri::async_runtime::spawn_blocking(move || {
        let mut samples: Vec<f32> = Vec::new();
        let summary = decode::decode_file(&path, |decoded| {
            samples.extend_from_slice(decoded);
            stream::send_f32_chunk(&on_chunk, decoded).map_err(DecodeError::Decode)
        })?;
        Ok::<_, DecodeError>((summary, samples))
    })
    .await
    .map_err(|err| DecodeError::Decode(err.to_string()))??;

    state.audio.install_source(
        request,
        Some(SourceData {
            samples,
            sample_rate: summary.sample_rate,
            channels: summary.channels,
        }),
    );

    stream::send_end_sentinel(&sentinel).map_err(DecodeError::Decode)?;

    Ok(summary)
}
