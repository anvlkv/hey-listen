//! Audio engines.
//!
//! These modules do the actual audio work (decode, capture, synthesis, filtering,
//! playback, analysis) and are deliberately free of `tauri` types — the command
//! layer in `crate::commands` adapts them to the IPC boundary. See
//! `docs/architecture.md`.

pub mod analysis;
pub mod capture;
pub mod decode;
pub mod graph;
pub mod pcm;
pub mod playback;

/// Interleaved samples per streamed chunk (256 KiB at 4 bytes/sample), shared by
/// the decode/render engines and the IPC streaming commands. Chosen to keep
/// `Channel` messages amortized while bounding per-message latency.
pub(crate) const STREAM_CHUNK_SAMPLES: usize = 64 * 1024;
