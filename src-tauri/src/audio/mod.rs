//! Audio engines.
//!
//! These modules do the actual audio work (decode, capture, synthesis, analysis)
//! and are deliberately free of `tauri` types — the command layer in
//! `crate::commands` adapts them to the IPC boundary. See `docs/architecture.md`.

pub mod capture;
pub mod decode;
