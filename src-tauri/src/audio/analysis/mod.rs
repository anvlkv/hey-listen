//! Analysis engine: thin wrappers over `oxiaudio` (ADR-5).
//!
//! Every analysis capability is exposed as a **tool** (see
//! `docs/analysis-tools.md`) invoked through the single `run_analysis` command.
//! This module owns the tool implementations and the shared signal conditioning;
//! the command layer only adapts state/IPC. It has no `tauri` dependency so it can
//! be unit-tested.
//!
//! Signal conditioning is deliberately identical to preview playback
//! (`commands/playback.rs`): the window is sliced from the source, **mixed down**
//! to the selected channel, **filtered** by the project's graph, then optionally
//! **resampled** — so what is analysed matches what is heard (ADR-9).
//!
//! The implementation is split into focused submodules: [`types`] and [`results`]
//! hold the data types, [`support`] the shared signal helpers, and [`tools`] the
//! per-family tool implementations plus the [`run`] dispatcher.

mod results;
mod shape;
mod summary;
mod support;
mod tools;
mod types;

pub use results::*;
pub use shape::*;
pub use summary::*;
pub use tools::*;
pub use types::*;

use crate::audio::graph::{self, GraphSpec};
use crate::audio::pcm;

/// Floor used for silence, so dB results are always finite and JSON-safe.
const DB_FLOOR: f32 = -120.0;
/// Buckets in the waveform envelope handed to the frontend.
const MAX_ENVELOPE: usize = 2048;
/// Cap on the spectrogram frame / bin count kept in the result (IPC size bound).
const MAX_SPEC_FRAMES: usize = 512;
const MAX_SPEC_BINS: usize = 512;
/// Cap on the STFT's transient memory: frames × bins complex cells. A longer
/// window widens the hop so the engine never allocates unboundedly.
const MAX_STFT_CELLS: usize = 8_000_000;

// Per-tool option defaults (see `docs/analysis-tools.md`).
const DEFAULT_N_MELS: usize = 64;
const DEFAULT_N_MFCC: usize = 13;
const DEFAULT_N_BANDS: usize = 6;
const DEFAULT_ROLLOFF: f32 = 0.85;
const DEFAULT_YIN_THRESHOLD: f32 = 0.12;
/// Autocorrelation's default f0 search range.
const AUTOCORR_MIN_F0: f32 = 60.0;
const AUTOCORR_MAX_F0: f32 = 1200.0;
/// YIN's default range, matching `PitchTracker::default`.
const YIN_MIN_F0: f32 = 50.0;
const YIN_MAX_F0: f32 = 2_000.0;
/// Harmonic-ratio's default: wide enough for calls above 2 kHz.
const HARMONIC_MIN_F0: f32 = 50.0;
const HARMONIC_MAX_F0: f32 = 4_000.0;
/// The range `oxiaudio`'s pYIN detector hardcodes (reported as its effective range).
const PYIN_MIN_F0: f32 = 50.0;
const PYIN_MAX_F0: f32 = 2_000.0;
/// Cap on frames for the O(frames × lags) pitch / harmonic-ratio tools, so a long
/// window stays interactive (the hop widens to keep the frame count bounded).
const MAX_PITCH_FRAMES: usize = 512;
/// Cap on frames for the onset-strength envelope handed to the rhythm charts.
const MAX_RHYTHM_FRAMES: usize = 4096;
/// Cap on frames for the frame-RMS envelope (M17), so a long window stays bounded.
const MAX_FRAME_RMS_FRAMES: usize = 8192;

const DEFAULT_BAR_LENGTH: usize = 4;
/// Frame-RMS defaults: 10 ms frames on a 5 ms hop (M17).
const DEFAULT_FRAME_MS: f32 = 10.0;
const DEFAULT_HOP_MS: f32 = 5.0;

// Note-segmentation defaults (M18).
/// Gate this far below the window's loudest frame.
const DEFAULT_GATE_DB: f32 = 35.0;
/// Absolute gate floor in dBFS.
const DEFAULT_GATE_FLOOR_DB: f32 = -60.0;
/// A note ends this far below the gate (after opening at the gate).
const DEFAULT_HYSTERESIS_DB: f32 = 3.0;
const DEFAULT_MIN_NOTE_MS: f32 = 20.0;
const DEFAULT_MIN_GAP_MS: f32 = 30.0;
const DEFAULT_ENVELOPE_POINTS: usize = 7;
/// Cap on the notes a single `noteMetrics` call returns (IPC size bound).
const MAX_NOTES: usize = 2_048;

// Note voice-quality proxy defaults (M19).
/// The frame length for a note's own pitch track: long enough for a stable YIN f0.
const DEFAULT_PITCH_FRAME_MS: f32 = 40.0;
/// The hop between those pitch frames: fine enough to see intra-note jitter.
const DEFAULT_PITCH_HOP_MS: f32 = 5.0;

// AM/FM modulation-spectrum defaults (M20).
/// The modulation-rate band the spectra cover, in Hz.
const DEFAULT_MOD_MIN_HZ: f32 = 0.5;
const DEFAULT_MOD_MAX_HZ: f32 = 100.0;
/// The shortest voiced run the FM half analyses.
const DEFAULT_MIN_VOICED_SECS: f32 = 0.2;
/// How many ranked peaks each spectrum returns.
const DEFAULT_TOP_PEAKS: usize = 3;
/// `detrend` option value for a linear fit; `0` removes the mean only.
const DEFAULT_DETREND: usize = 1;
/// Cap on the modulation-spectrum bins kept in the result (IPC size bound).
const MAX_MOD_BINS: usize = 512;
/// Cap on the modulation FFT length, so zero-padding stays bounded.
const MAX_MOD_FFT: usize = 65_536;
/// Frame cap for the fine pitch pass that tracks the FM run. Much looser than the
/// per-note grid, because a modulation run can span seconds.
const MAX_MOD_PITCH_FRAMES: usize = 2_048;
/// Frame cap for the coarse pass that only needs to find the longest voiced run: kept
/// small because its frame is sized for the lowest expected f0 (so each frame is
/// comparatively expensive).
const MAX_COARSE_PITCH_FRAMES: usize = 256;
/// Below this many voiced frames the FM depth figures are `None`.
const MIN_FM_FRAMES: usize = 8;
/// Distinct cents values an FM residual needs before its rate is trusted. A pYIN
/// track that visits only a handful of levels (`392, 415, 392, 370`, repeated) is a
/// staircase, not a vibrato, and its spectrum invents a rate (M21.B).
const MIN_FM_DISTINCT_CENTS: usize = 5;
/// Voiced frames a pitch track needs before its median is called a pitch (M21.B).
/// Below this the track is reported (with `f0Reliable: false`) but the summary omits
/// a median, so a handful of frames is never presented as an f0.
const MIN_RELIABLE_VOICED_FRAMES: usize = 8;

// --- signal conditioning -------------------------------------------------

/// Run a tool over `start..end` of a project's source, synchronously.
///
/// Reads the source PCM and the active filter from `state`, slices the region, and
/// conditions it exactly like preview (mixdown → filter → resample) before running
/// the tool. The GUI `run_analysis` command wraps this in `spawn_blocking`; the
/// headless MCP dispatcher calls it directly. Keeping the slice + conditioning in
/// one place means the two paths cannot diverge.
///
/// `start`/`end` are source seconds; the region is clamped to the source.
pub fn run_window(
    state: &crate::state::WindowState,
    tool: &str,
    start: f64,
    end: f64,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<AnalysisResult, AnalysisError> {
    // Slice the windowed region (a copy) and read the active filter under the lock,
    // then release it before the CPU-bound work runs.
    let (region, channels, sample_rate, filter) = {
        let guard = state
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let source = guard.as_ref().ok_or(AnalysisError::NoSource)?;

        let channels = source.channels.max(1) as usize;
        let frames = source.samples.len() / channels;
        let sample_rate = source.sample_rate.max(1);

        let first = ((start.max(0.0) * f64::from(sample_rate)).floor() as usize).min(frames);
        let last = ((end.max(0.0) * f64::from(sample_rate)).ceil() as usize)
            .min(frames)
            .max(first);
        if last <= first {
            return Err(AnalysisError::EmptyWindow);
        }
        let region = source.samples[first * channels..last * channels].to_vec();

        let filter = state
            .audio
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone();

        (region, source.channels.max(1), sample_rate, filter)
    };

    let (mono, rate) = condition(
        &region,
        channels,
        sample_rate,
        filter.as_ref(),
        params.channel,
        params.resample_to,
    )?;
    // The tools see only the sliced region (their times begin at 0), so re-base the
    // result onto source seconds here — the single place that knows where the window
    // sits. Everything downstream (GUI, MCP, CLI, exports) then speaks absolute time.
    let mut result = run(tool, &mono, rate, params, options)?;
    result.rebase(start);
    Ok(result)
}

/// Reduce the windowed interleaved region to mono and condition it the same way
/// preview does: mixdown → filter → resample. Returns `(mono, sample_rate)`.
pub fn condition(
    region: &[f32],
    channels: u16,
    sample_rate: u32,
    filter: Option<&GraphSpec>,
    channel: Option<usize>,
    resample_to: Option<u32>,
) -> Result<(Vec<f32>, u32), AnalysisError> {
    let channels = channels.max(1) as usize;
    let rate = sample_rate.max(1);

    let mono = pcm::mixdown(region, channels, channel);
    let mono = match filter {
        Some(spec) => graph::apply_mono(spec, &mono, rate)
            .map_err(|err| AnalysisError::Filter(err.to_string()))?,
        None => mono,
    };
    let rate = resample_to
        .map(|to| to.clamp(8_000, 384_000))
        .unwrap_or(rate);
    let mono = pcm::resample_linear(&mono, sample_rate.max(1), rate);
    Ok((mono, rate))
}

#[cfg(test)]
pub(crate) mod fixtures;
#[cfg(test)]
mod tests;
