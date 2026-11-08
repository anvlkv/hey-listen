//! Core-owned state: the audio backing the timeline (this module) and the state that
//! belongs to a single project window ([`window`]).
//!
//! The Rust core owns the PCM behind the timeline (ADR-9): file decodes and synth
//! renders write it, live capture appends to it, and preview playback reads it.
//! The frontend keeps its own copy only for rendering the waveform (a transitional
//! duplication — see `docs/decisions.md` → ADR-9).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::audio::graph::GraphSpec;
use crate::audio::playback::Playback;

/// The current source's PCM (interleaved `f32`).
#[derive(Debug, Clone)]
pub struct SourceData {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

/// One accepted source-replacement request.
///
/// A decode/render completes off the main thread, so two replacements can finish out of
/// order. Every replacement claims a request when it **starts** and installs its PCM
/// only while that request is still the newest, so an older decode can never overwrite a
/// newer source (audit P1 #2). The id is the frontend's monotonic open token (an internal
/// claim, for capture or a token-less load, keeps the token and bumps the epoch).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceRequest {
    token: u64,
    epoch: u64,
}

/// The newest accepted source request.
#[derive(Debug, Default, Clone, Copy)]
struct SourceGate {
    token: u64,
    epoch: u64,
}

/// Shared state behind the playback/filter source: one per app (one window = one
/// project = one source).
pub struct AudioState {
    /// The source PCM. The `Arc`/`Mutex` lets the capture thread append while the
    /// command layer reads.
    pub source: Arc<Mutex<Option<SourceData>>>,
    /// While true, live-capture chunks are appended to `source`.
    pub recording: Arc<AtomicBool>,
    /// The active filter graph, applied before preview (and, from M4, analysis).
    pub filter: Arc<Mutex<Option<GraphSpec>>>,
    /// Bumped whenever the audio (its source or filter) changes, so a comparison can
    /// tell that a peer project moved without polling its whole setup (M25).
    pub revision: Arc<AtomicU64>,
    /// The newest accepted source-replacement request (see [`SourceRequest`]).
    source_gate: Mutex<SourceGate>,
    pub playback: Playback,
}

/// A cheap, cloneable handle for appending capture chunks from the capture thread
/// without holding the whole [`AudioState`].
#[derive(Clone)]
pub struct RecordingSink {
    source: Arc<Mutex<Option<SourceData>>>,
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
            revision: Arc::new(AtomicU64::new(0)),
            source_gate: Mutex::new(SourceGate::default()),
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

    /// Claim a source-replacement request identified by the frontend's open token.
    ///
    /// `None` means an **older** request (a smaller token) arrived after a newer one
    /// started: it is ignored, so it can neither install audio nor clear the source.
    pub fn claim_source_request(&self, token: u64) -> Option<SourceRequest> {
        let mut gate = self
            .source_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if token < gate.token {
            return None;
        }
        gate.token = token;
        Some(advance(&mut gate))
    }

    /// Claim a replacement that carries no open token (live capture, a token-less load).
    /// It invalidates every request already in flight.
    pub fn claim_internal_source_request(&self) -> SourceRequest {
        let mut gate = self
            .source_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        advance(&mut gate)
    }

    /// Install the PCM for an accepted `request`, unless a newer replacement started
    /// while this one was decoding. Returns whether the PCM was installed.
    pub fn install_source(&self, request: SourceRequest, source: Option<SourceData>) -> bool {
        // Hold the gate across the check and the install: otherwise a newer request could
        // claim between the two and this stale write would still land.
        let gate = self
            .source_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if gate.token != request.token || gate.epoch != request.epoch {
            return false;
        }
        self.set_source(source);
        true
    }

    /// Replace the source PCM (file decode / synth render).
    pub fn set_source(&self, source: Option<SourceData>) {
        self.recording.store(false, Ordering::Relaxed);
        *self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = source;
        self.touch();
    }

    /// A copy of the current PCM for a project save.
    ///
    /// The lock is held only for the clone, never across the file write, so a slow disk
    /// cannot stall the live-capture appender (audit P2 #4).
    pub fn snapshot_source(&self) -> Option<SourceData> {
        self.source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    /// Replace the filter graph; `None` bypasses filtering.
    pub fn set_filter(&self, spec: Option<GraphSpec>) {
        *self
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = spec;
        self.touch();
    }

    /// The audio's revision (monotonic within a process).
    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::Relaxed)
    }

    /// Mark the audio as changed.
    fn touch(&self) {
        self.revision.fetch_add(1, Ordering::Relaxed);
    }

    /// Begin a fresh recording buffer (called when Record starts).
    pub fn begin_recording(&self, sample_rate: u32, channels: u16) {
        // Starting a capture replaces the source, so an in-flight decode must not install
        // its audio over the recording.
        self.claim_internal_source_request();
        let mut guard = self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        *guard = Some(SourceData {
            samples: Vec::new(),
            sample_rate,
            channels,
        });
        self.recording.store(true, Ordering::Relaxed);
        self.touch();
    }

    /// Stop appending capture chunks (the recorded audio is kept).
    pub fn end_recording(&self) {
        self.recording.store(false, Ordering::Relaxed);
    }

    /// Drop the PCM for an accepted `request`, unless a newer replacement started since.
    /// Returns whether the source was cleared.
    pub fn clear_source(&self, request: SourceRequest) -> bool {
        let gate = self
            .source_gate
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if gate.token != request.token || gate.epoch != request.epoch {
            return false;
        }
        self.clear();
        true
    }

    /// Drop the source PCM and silence preview (used when the source changes).
    pub fn clear(&self) {
        self.recording.store(false, Ordering::Relaxed);
        *self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = None;
        self.playback.stop();
        self.touch();
    }
}

impl Default for AudioState {
    fn default() -> Self {
        Self::new()
    }
}

/// Open a new epoch for the accepted request (the caller holds the gate lock).
fn advance(gate: &mut SourceGate) -> SourceRequest {
    gate.epoch += 1;
    SourceRequest {
        token: gate.token,
        epoch: gate.epoch,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn pcm(marker: f32) -> SourceData {
        SourceData {
            samples: vec![marker; 4],
            sample_rate: 8_000,
            channels: 1,
        }
    }

    /// The pre-fix bug: two overlapping opens decode concurrently, the *older* one
    /// finishes last and installs its PCM, so the timeline (newest) and the core
    /// (playback/analysis) disagreed. The newest claim must win regardless of finish order.
    #[test]
    fn an_out_of_order_decode_cannot_install_over_a_newer_request() {
        let audio = AudioState::new();
        let older = audio.claim_source_request(1).expect("older claims first");
        let newer = audio.claim_source_request(2).expect("newer claims second");

        // The newer decode finishes first...
        assert!(audio.install_source(newer, Some(pcm(2.0))));
        // ...and the older one completes afterwards, which must be ignored.
        assert!(!audio.install_source(older, Some(pcm(1.0))));
        let source = audio.snapshot_source().expect("source installed");
        assert_eq!(source.samples, vec![2.0; 4]);
    }

    #[test]
    fn an_older_open_token_is_rejected_after_a_newer_one() {
        let audio = AudioState::new();
        assert!(audio.claim_source_request(2).is_some());
        assert!(audio.claim_source_request(1).is_none());
    }

    #[test]
    fn a_started_capture_invalidates_an_in_flight_decode() {
        let audio = AudioState::new();
        let request = audio.claim_source_request(1).expect("claim");
        audio.begin_recording(8_000, 1);
        assert!(!audio.install_source(request, Some(pcm(1.0))));
        assert!(
            audio.snapshot_source().is_some(),
            "the recording buffer stays"
        );
    }

    /// `save_project` snapshots the PCM and writes it after releasing the lock, so capture
    /// keeps appending during a slow disk write (audit P2 #4).
    #[test]
    fn snapshotting_the_source_does_not_block_live_capture() {
        let audio = AudioState::new();
        audio.begin_recording(8_000, 1);
        let snapshot = audio.snapshot_source().expect("source");

        let sink = audio.recording_sink();
        let appender = std::thread::spawn(move || {
            let mut worst = Duration::ZERO;
            for _ in 0..4 {
                let started = Instant::now();
                sink.append(&[0.25; 16]);
                worst = worst.max(started.elapsed());
                std::thread::sleep(Duration::from_millis(5));
            }
            worst
        });
        // Stand in for the disk write: the source lock must be free the whole time.
        std::thread::sleep(Duration::from_millis(60));
        let worst = appender.join().expect("appender");
        assert!(
            worst < Duration::from_millis(25),
            "capture waited {worst:?} for the source lock"
        );

        // The snapshot is a private copy: later appends do not change it.
        assert_eq!(snapshot.samples.len(), 0);
        let current = audio.snapshot_source().expect("source");
        assert_eq!(current.samples.len(), 64);
    }
}

mod window;

pub use window::{window_state, CompareView, WindowRegistry, WindowState};
