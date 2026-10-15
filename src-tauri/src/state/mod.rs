//! Core-owned state: the audio backing the timeline (this module) and the state that
//! belongs to a single project window ([`window`]).
//!
//! The Rust core owns the PCM behind the timeline (ADR-9): file decodes and synth
//! renders write it, live capture appends to it, and preview playback reads it.
//! The frontend keeps its own copy only for rendering the waveform (a transitional
//! duplication — see `docs/decisions.md` → ADR-9).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::audio::graph::GraphSpec;
use crate::audio::playback::Playback;

/// The current source's PCM (interleaved `f32`).
#[derive(Debug, Clone)]
pub struct SourcePcm {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Shared state behind the playback/filter source: one per app (one window = one
/// project = one source).
pub struct AudioState {
    /// The source PCM. The `Arc`/`Mutex` lets the capture thread append while the
    /// command layer reads.
    pub source: Arc<Mutex<Option<SourcePcm>>>,
    /// While true, live-capture chunks are appended to `source`.
    pub recording: Arc<AtomicBool>,
    /// The active filter graph, applied before preview (and, from M4, analysis).
    pub filter: Arc<Mutex<Option<GraphSpec>>>,
    pub playback: Playback,
}

/// A cheap, cloneable handle for appending capture chunks from the capture thread
/// without holding the whole [`AudioState`].
#[derive(Clone)]
pub struct RecordingSink {
    source: Arc<Mutex<Option<SourcePcm>>>,
    recording: Arc<AtomicBool>,
}

impl RecordingSink {
    /// Append captured interleaved samples while recording.
    pub fn append(&self, interleaved: &[f32]) {
        if !self.recording.load(Ordering::Relaxed) {
            return;
        }
        let mut guard = self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(source) = guard.as_mut() {
            source.samples.extend_from_slice(interleaved);
        }
    }
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            source: Arc::new(Mutex::new(None)),
            recording: Arc::new(AtomicBool::new(false)),
            filter: Arc::new(Mutex::new(None)),
            playback: Playback::new(),
        }
    }

    /// A handle for appending live-capture chunks from another thread.
    pub fn recording_sink(&self) -> RecordingSink {
        RecordingSink {
            source: self.source.clone(),
            recording: self.recording.clone(),
        }
    }

    /// Replace the source PCM (file decode / synth render).
    pub fn set_source(&self, source: Option<SourcePcm>) {
        self.recording.store(false, Ordering::Relaxed);
        *self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = source;
    }

    /// Replace the filter graph; `None` bypasses filtering.
    pub fn set_filter(&self, spec: Option<GraphSpec>) {
        *self
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = spec;
    }

    /// Begin a fresh recording buffer (called when Record starts).
    pub fn begin_recording(&self, sample_rate: u32, channels: u16) {
        let mut guard = self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        *guard = Some(SourcePcm {
            samples: Vec::new(),
            sample_rate,
            channels,
        });
        self.recording.store(true, Ordering::Relaxed);
    }

    /// Stop appending capture chunks (the recorded audio is kept).
    pub fn end_recording(&self) {
        self.recording.store(false, Ordering::Relaxed);
    }

    /// Drop the source PCM and silence preview (used when the source changes).
    pub fn clear(&self) {
        self.recording.store(false, Ordering::Relaxed);
        *self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = None;
        self.playback.stop();
    }
}

impl Default for AudioState {
    fn default() -> Self {
        Self::new()
    }
}

mod window;

pub use window::{window_state, WindowRegistry, WindowState};
