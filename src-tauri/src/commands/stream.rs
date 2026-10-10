//! Shared helpers for streaming PCM to the frontend over an [`ipc::Channel`].
//!
//! Every one-shot command that hands audio to the frontend (file decode, project
//! load, synth render, filtered render) serializes interleaved `f32` samples to
//! little-endian bytes and sends them in fixed chunks, followed by a zero-length
//! end-of-stream sentinel. Live capture streams the same chunk encoding (without a
//! sentinel). Keeping the encoding in one place keeps the wire format consistent.

use tauri::ipc::{Channel, InvokeResponseBody};

/// Serialize `samples` to little-endian `f32` bytes and send them as one channel
/// message.
///
/// Returns the send failure as a `String` so each caller can map it to its own
/// error enum (the message text is unchanged from the previous inlined loops).
pub(crate) fn send_f32_chunk(
    channel: &Channel<InvokeResponseBody>,
    samples: &[f32],
) -> Result<(), String> {
    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    channel
        .send(InvokeResponseBody::Raw(bytes))
        .map_err(|err| err.to_string())
}

/// Send the zero-length end-of-stream sentinel used by the one-shot commands.
///
/// Large chunks are delivered asynchronously, so the frontend must not assume the
/// last one arrived when the command itself returns.
pub(crate) fn send_end_sentinel(channel: &Channel<InvokeResponseBody>) -> Result<(), String> {
    channel
        .send(InvokeResponseBody::Raw(Vec::new()))
        .map_err(|err| err.to_string())
}
