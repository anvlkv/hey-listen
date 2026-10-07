//! Decode/file-source commands.

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::audio::decode::{self, DecodeError, ProbeInfo, StreamSummary};

/// Inspect a file's container/codec metadata (codec, sample rate, channels,
/// duration) without decoding it.
#[tauri::command]
pub fn probe_file(path: String) -> Result<ProbeInfo, DecodeError> {
    decode::probe(&path)
}

/// Decode a file and stream interleaved `f32` PCM to the frontend as raw bytes
/// (little-endian) over an ordered [`Channel`].
///
/// The CPU-bound decode runs on the blocking pool so the async workers stay free
/// for capture/decode, per `docs/architecture.md` → "Threading".
#[tauri::command]
pub async fn stream_file(
    path: String,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<StreamSummary, DecodeError> {
    tauri::async_runtime::spawn_blocking(move || {
        decode::decode_file(&path, |samples| {
            let mut bytes = Vec::with_capacity(std::mem::size_of_val(samples));
            for sample in samples {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
            on_chunk
                .send(InvokeResponseBody::Raw(bytes))
                .map_err(|err| DecodeError::Decode(err.to_string()))
        })
    })
    .await
    .map_err(|err| DecodeError::Decode(err.to_string()))?
}
