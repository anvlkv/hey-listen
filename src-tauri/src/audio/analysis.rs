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

use oxiaudio::dsp::spectral::{stft, WindowFn};
use oxiaudio::dsp::PitchFrame;
use oxiaudio::{AudioBuffer, ChannelLayout, SampleFormat};
use serde::{Deserialize, Serialize};

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
const DEFAULT_MIN_F0: f32 = 60.0;
const DEFAULT_MAX_F0: f32 = 1200.0;
/// Cap on frames for the O(frames × lags) pitch / harmonic-ratio tools, so a long
/// window stays interactive (the hop widens to keep the frame count bounded).
const MAX_PITCH_FRAMES: usize = 512;
/// Cap on frames for the onset-strength envelope handed to the rhythm charts.
const MAX_RHYTHM_FRAMES: usize = 4096;

const DEFAULT_BAR_LENGTH: usize = 4;

/// A window function for frame-based tools (`docs/analysis-tools.md`).
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum WindowKind {
    #[default]
    Hann,
    Hamming,
    Blackman,
    Rectangular,
}

impl WindowKind {
    fn to_window_fn(self) -> WindowFn {
        match self {
            WindowKind::Hann => WindowFn::Hann,
            WindowKind::Hamming => WindowFn::Hamming,
            WindowKind::Blackman => WindowFn::Blackman,
            WindowKind::Rectangular => WindowFn::Rectangular,
        }
    }
}

/// Shared analysis params, synced across tools in the frontend (ADR-6) and sent
/// with every `run_analysis` call. See `docs/data-model.md` → `SharedParams`.
///
/// Also `Serialize`/`Default` so the project file can persist the analysis setup.
#[derive(Debug, Clone, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SharedParams {
    /// FFT window size in samples (the UI offers 512…8192).
    pub fft_size: usize,
    /// Hop as a fraction of the window (0 < hop ≤ 1); 0.25 = 75% overlap.
    pub hop: f64,
    /// Optional overlap randomization (see [`stft_magnitudes`]).
    #[serde(default)]
    pub randomized_overlap: bool,
    pub window_fn: WindowKind,
    /// 0-based channel index, or `None` for a downmix of all channels.
    #[serde(default)]
    pub channel: Option<usize>,
    /// Optional analysis sample rate (resample before analysis).
    #[serde(default)]
    pub resample_to: Option<u32>,
    /// Band limit for spectral/pitch tools, in Hz.
    #[serde(default)]
    pub freq_min_hz: f64,
    #[serde(default)]
    pub freq_max_hz: f64,
}

impl SharedParams {
    /// The FFT size clamped to a sane range.
    fn fft_size(&self) -> usize {
        self.fft_size.clamp(64, 32_768)
    }

    /// The hop converted to samples (≥ 1) for `fft`.
    fn hop_size(&self, fft: usize) -> usize {
        let hop = if self.hop.is_finite() { self.hop } else { 0.25 };
        ((fft as f64) * hop.clamp(0.01, 1.0)).round().max(1.0) as usize
    }

    /// The band-limit range clamped to `[0, nyquist]`.
    fn band(&self, sample_rate: u32) -> (f64, f64) {
        let nyquist = f64::from(sample_rate) / 2.0;
        let min = if self.freq_min_hz.is_finite() {
            self.freq_min_hz.max(0.0)
        } else {
            0.0
        };
        let max = if self.freq_max_hz.is_finite() && self.freq_max_hz > 0.0 {
            self.freq_max_hz.min(nyquist)
        } else {
            nyquist
        };
        (min, max.max(min))
    }
}

/// Errors produced by the analysis engine.
#[derive(Debug, thiserror::Error)]
pub enum AnalysisError {
    #[error("no audio source is loaded")]
    NoSource,
    #[error("the analysis window is empty")]
    EmptyWindow,
    #[error("unknown analysis tool: {0}")]
    UnknownTool(String),
    #[error("analysis failed: {0}")]
    Analysis(String),
    #[error("filter graph failed to apply: {0}")]
    Filter(String),
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(AnalysisError);

// --- results -------------------------------------------------------------

/// Time-domain waveform over the window plus its level readouts.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WaveformResult {
    pub sample_rate: u32,
    pub frames: usize,
    pub duration: f64,
    /// Peak amplitude (linear, 0…1+).
    pub peak: f32,
    pub rms: f32,
    pub peak_db: f32,
    pub rms_db: f32,
    /// Min/max envelope over the window (equal length, `MAX_ENVELOPE` buckets max).
    pub min: Vec<f32>,
    pub max: Vec<f32>,
}

/// Averaged magnitude spectrum over the window.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpectrumResult {
    pub sample_rate: u32,
    pub fft_size: usize,
    pub hop_size: usize,
    /// Number of STFT frames averaged.
    pub frames: usize,
    /// Bin centre frequencies (Hz) — band-limited.
    pub freqs: Vec<f32>,
    /// Mean magnitude per bin, in dBFS.
    pub mag_db: Vec<f32>,
    /// Minimum magnitude per bin across frames, in dBFS.
    pub min_db: Vec<f32>,
    /// Maximum magnitude per bin across frames, in dBFS.
    pub max_db: Vec<f32>,
    /// Frequency (Hz) and level (dBFS) of the strongest bin.
    pub peak_hz: f32,
    pub peak_db: f32,
}

/// STFT magnitude heatmap over the window.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpectrogramResult {
    pub sample_rate: u32,
    pub fft_size: usize,
    pub hop_size: usize,
    pub duration: f64,
    /// Frame (time) and bin (frequency) counts of `mag_db`.
    pub frames: usize,
    pub bins: usize,
    /// Bin centre frequencies (Hz) for the retained bins — band-limited.
    pub freqs: Vec<f32>,
    /// Row-major `frames * bins` magnitudes in dBFS (frame-major).
    pub mag_db: Vec<f32>,
    pub min_db: f32,
    pub max_db: f32,
}

/// Time-domain level readouts (peak / RMS), without the waveform envelope.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LevelsResult {
    pub sample_rate: u32,
    pub frames: usize,
    pub duration: f64,
    pub peak: f32,
    pub rms: f32,
    pub peak_db: f32,
    pub rms_db: f32,
}

/// One scalar value per analysis frame, plotted against time. `values` may contain
/// gaps (`None`) — e.g. unvoiced pitch frames or silent loudness blocks.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SeriesResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    /// Frame times in seconds.
    pub times: Vec<f32>,
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
}

/// A pitch track: the f0 series over time plus a voiced-frame summary, so a
/// near-empty track (almost no voiced frames) is self-evident without scanning
/// every `values` entry. Unvoiced frames are gaps (`null`).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PitchResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    /// Frame times in seconds.
    pub times: Vec<f32>,
    /// f0 in Hz per frame; unvoiced frames are gaps.
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    /// Frames with a detected pitch (non-gap `values`).
    pub voiced_frames: usize,
    /// `voiced_frames / frames` (0…1; 0 when there are no frames).
    pub voiced_fraction: f32,
}

/// A frame × band matrix (mel spectrogram, MFCC, chromagram, spectral contrast).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatrixResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    pub bins: usize,
    pub duration: f32,
    /// Frame times in seconds.
    pub times: Vec<f32>,
    /// Band-axis positions (index or Hz) for the retained bands.
    pub bands: Vec<f32>,
    /// Frame-major `frames * bins` values.
    pub values: Vec<f32>,
    pub min_value: f32,
    pub max_value: f32,
}

/// Tempo / onset / downbeat analysis over one window: the onset-strength envelope
/// (one value per frame) plus the detected beat grid and event times. The rhythm
/// charts draw the envelope and mark the relevant events on it.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RhythmResult {
    pub bpm: f32,
    pub confidence: f32,
    pub hop_size: usize,
    /// Frame times (seconds) of `onset_strength`.
    pub times: Vec<f32>,
    /// Onset-strength envelope (half-wave-rectified spectral flux).
    pub onset_strength: Vec<f32>,
    /// Detected onset times (seconds).
    pub onset_times: Vec<f32>,
    /// Estimated beat times (seconds).
    pub beat_times: Vec<f32>,
    /// Estimated downbeat times (seconds).
    pub downbeat_times: Vec<f32>,
}

/// Integrated loudness (EBU R128).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LufsResult {
    pub lufs: f32,
}

/// Loudness range (LRA), in LU.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LraResult {
    pub lra: f32,
}

/// Per-tool options (not shared across tools). Absent fields fall back to the tool
/// defaults; see `docs/analysis-tools.md`.
#[derive(Debug, Clone, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ToolOptions {
    #[serde(default)]
    pub n_mels: Option<usize>,
    #[serde(default)]
    pub n_mfcc: Option<usize>,
    #[serde(default)]
    pub n_bands: Option<usize>,
    #[serde(default)]
    pub rolloff_percent: Option<f32>,
    #[serde(default)]
    pub yin_threshold: Option<f32>,
    #[serde(default)]
    pub min_f0_hz: Option<f32>,
    #[serde(default)]
    pub max_f0_hz: Option<f32>,
    #[serde(default)]
    pub bar_length: Option<usize>,
    #[serde(default)]
    pub window_ms: Option<u32>,
    #[serde(default)]
    pub f_min_hz: Option<f32>,
    #[serde(default)]
    pub f_max_hz: Option<f32>,
}

impl ToolOptions {
    fn n_mels(&self) -> usize {
        self.n_mels.unwrap_or(DEFAULT_N_MELS).clamp(8, 256)
    }

    fn n_mfcc(&self) -> usize {
        self.n_mfcc.unwrap_or(DEFAULT_N_MFCC).clamp(1, 64)
    }

    fn n_bands(&self) -> usize {
        self.n_bands.unwrap_or(DEFAULT_N_BANDS).clamp(2, 16)
    }

    fn rolloff_percent(&self) -> f32 {
        self.rolloff_percent
            .unwrap_or(DEFAULT_ROLLOFF)
            .clamp(0.01, 0.99)
    }

    fn yin_threshold(&self) -> f32 {
        self.yin_threshold
            .unwrap_or(DEFAULT_YIN_THRESHOLD)
            .clamp(0.01, 0.9)
    }

    fn min_f0_hz(&self) -> f32 {
        self.min_f0_hz.unwrap_or(DEFAULT_MIN_F0).max(1.0)
    }

    fn max_f0_hz(&self) -> f32 {
        self.max_f0_hz
            .unwrap_or(DEFAULT_MAX_F0)
            .max(self.min_f0_hz() + 1.0)
    }

    fn bar_length(&self) -> usize {
        self.bar_length.unwrap_or(DEFAULT_BAR_LENGTH).clamp(2, 12)
    }

    fn window_ms(&self) -> Option<u32> {
        self.window_ms.filter(|&ms| ms > 0)
    }

    fn mel_f_min(&self) -> Option<f32> {
        self.f_min_hz.filter(|&f| f > 0.0)
    }

    fn mel_f_max(&self) -> Option<f32> {
        self.f_max_hz.filter(|&f| f > 0.0)
    }
}

/// A tool's result, tagged by the tool id that produced it.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(tag = "tool", rename_all = "camelCase")]
#[ts(export)]
pub enum AnalysisResult {
    Waveform(WaveformResult),
    Spectrum(SpectrumResult),
    Spectrogram(SpectrogramResult),
    Levels(LevelsResult),
    MelSpectrogram(MatrixResult),
    Mfcc(MatrixResult),
    Chromagram(MatrixResult),
    SpectralContrast(MatrixResult),
    SpectralCentroid(SeriesResult),
    SpectralFlux(SeriesResult),
    SpectralRolloff(SeriesResult),
    SpectralFlatness(SeriesResult),
    SpectralBandwidth(SeriesResult),
    SpectralEntropy(SeriesResult),
    SpectralCrest(SeriesResult),
    HarmonicRatio(SeriesResult),
    ZeroCrossingRate(SeriesResult),
    PitchPyin(PitchResult),
    PitchYin(PitchResult),
    PitchAutocorr(PitchResult),
    Tempo(RhythmResult),
    Onsets(RhythmResult),
    Downbeats(RhythmResult),
    LoudnessIntegrated(LufsResult),
    LoudnessMomentary(SeriesResult),
    LoudnessRange(LraResult),
}

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
    run(tool, &mono, rate, params, options)
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

/// Build a mono `oxiaudio` buffer view over `samples`.
fn mono_buffer(samples: &[f32], sample_rate: u32) -> AudioBuffer<f32> {
    AudioBuffer {
        samples: samples.to_vec(),
        sample_rate: sample_rate.max(1),
        channels: ChannelLayout::Mono,
        format: SampleFormat::F32,
    }
}

/// dBFS clamped to [`DB_FLOOR`] so silence serializes to a finite number.
fn db_or_floor(db: f32) -> f32 {
    if db.is_finite() {
        db.max(DB_FLOOR)
    } else {
        DB_FLOOR
    }
}

// --- tools ---------------------------------------------------------------

/// Time-domain waveform: peak/RMS levels (via `oxiaudio`) and a min/max envelope.
pub fn waveform(mono: &[f32], sample_rate: u32) -> WaveformResult {
    let buf = mono_buffer(mono, sample_rate);
    let (min, max) = envelope(mono, MAX_ENVELOPE);
    WaveformResult {
        sample_rate,
        frames: mono.len(),
        duration: if sample_rate > 0 {
            mono.len() as f64 / f64::from(sample_rate)
        } else {
            0.0
        },
        peak: buf.peak_amplitude(),
        rms: buf.rms_amplitude(),
        peak_db: db_or_floor(buf.peak_db()),
        rms_db: db_or_floor(buf.rms_db()),
        min,
        max,
    }
}

/// Averaged magnitude spectrum (Welch-style): the mean magnitude per bin.
pub fn spectrum(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<SpectrumResult, AnalysisError> {
    let params = effective_params(params, sample_rate);
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (mags, frames) = stft_magnitudes(mono, sample_rate, fft, hop, &params)?;
    let bins = fft / 2 + 1;
    let (min_hz, max_hz) = params.band(sample_rate);

    let mut freqs = Vec::new();
    let mut mag_db = Vec::new();
    let mut min_db = Vec::new();
    let mut max_db = Vec::new();
    let mut peak_hz = 0.0f32;
    let mut peak_db = DB_FLOOR;
    for k in 0..bins {
        let freq = k as f64 * f64::from(sample_rate) / fft as f64;
        if freq < min_hz || freq > max_hz {
            continue;
        }
        // Mean / min / max of the linear magnitude across the window's frames.
        let (mean, min, max) = if frames > 0 {
            let mut sum = 0.0f32;
            let mut min = f32::INFINITY;
            let mut max = f32::NEG_INFINITY;
            for frame in &mags {
                let value = frame[k];
                sum += value;
                min = min.min(value);
                max = max.max(value);
            }
            (sum / frames as f32, min, max)
        } else {
            (0.0, 0.0, 0.0)
        };
        let db = db_or_floor(20.0 * mean.max(1e-10).log10());
        if db > peak_db {
            peak_db = db;
            peak_hz = freq as f32;
        }
        freqs.push(freq as f32);
        mag_db.push(db);
        min_db.push(db_or_floor(20.0 * min.max(1e-10).log10()));
        max_db.push(db_or_floor(20.0 * max.max(1e-10).log10()));
    }

    Ok(SpectrumResult {
        sample_rate,
        fft_size: fft,
        hop_size: hop,
        frames,
        freqs,
        mag_db,
        min_db,
        max_db,
        peak_hz,
        peak_db,
    })
}

/// STFT magnitude heatmap (frame × frequency), band-limited and size-capped.
pub fn spectrogram(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<SpectrogramResult, AnalysisError> {
    let params = effective_params(params, sample_rate);
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (mags, frames) = stft_magnitudes(mono, sample_rate, fft, hop, &params)?;
    let all_bins = fft / 2 + 1;
    let (min_hz, max_hz) = params.band(sample_rate);

    // Keep the bins inside the band, then cap the count (max magnitude per group).
    let kept: Vec<usize> = (0..all_bins)
        .filter(|&k| {
            let freq = k as f64 * f64::from(sample_rate) / fft as f64;
            freq >= min_hz && freq <= max_hz
        })
        .collect();
    let bins = kept.len();
    let bin_group = if bins == 0 {
        1
    } else {
        bins.div_ceil(MAX_SPEC_BINS).max(1)
    };

    let frame_group = if frames == 0 {
        1
    } else {
        frames.div_ceil(MAX_SPEC_FRAMES).max(1)
    };

    // Bin centre frequencies for the retained (grouped) bins.
    let mut freqs = Vec::with_capacity(bins.div_ceil(bin_group));
    for group in kept.chunks(bin_group) {
        let sum: f64 = group
            .iter()
            .map(|&k| k as f64 * f64::from(sample_rate) / fft as f64)
            .sum();
        freqs.push((sum / group.len() as f64) as f32);
    }

    let out_frames = frames.div_ceil(frame_group);
    let mut mag_db = Vec::with_capacity(out_frames * freqs.len());
    let mut min_db = f32::INFINITY;
    let mut max_db = DB_FLOOR;
    for frame_group_start in (0..frames).step_by(frame_group) {
        let frame_end = (frame_group_start + frame_group).min(frames);
        for group in kept.chunks(bin_group) {
            let mut value = DB_FLOOR;
            for frame in &mags[frame_group_start..frame_end] {
                for &k in group {
                    let db = db_or_floor(20.0 * frame[k].max(1e-10).log10());
                    if db > value {
                        value = db;
                    }
                }
            }
            if value < min_db {
                min_db = value;
            }
            if value > max_db {
                max_db = value;
            }
            mag_db.push(value);
        }
    }

    if !min_db.is_finite() {
        min_db = DB_FLOOR;
    }

    Ok(SpectrogramResult {
        sample_rate,
        fft_size: fft,
        hop_size: hop,
        duration: if sample_rate > 0 {
            mono.len() as f64 / f64::from(sample_rate)
        } else {
            0.0
        },
        frames: out_frames,
        bins: freqs.len(),
        freqs,
        mag_db,
        min_db,
        max_db,
    })
}

// --- tool helpers --------------------------------------------------------

fn seconds(frames: usize, sample_rate: u32) -> f64 {
    if sample_rate > 0 {
        frames as f64 / f64::from(sample_rate)
    } else {
        0.0
    }
}

/// The `(fft, hop)` grid a frame-based tool should use for this signal.
fn frame_grid(len: usize, params: &SharedParams) -> (usize, usize) {
    let fft = params.fft_size();
    let hop = effective_hop(fft, len, params.hop_size(fft));
    (fft, hop)
}

/// Zero-pad `mono` up to `fft` samples. The library's frame-based features (unlike
/// our STFT) do not pad, so a window shorter than the FFT would otherwise yield no
/// frames at all — padding keeps them (and the pitch trackers) non-empty.
fn pad_to_fft(mono: &[f32], fft: usize) -> Vec<f32> {
    let mut buffer = vec![0.0f32; fft];
    let n = mono.len().min(fft);
    buffer[..n].copy_from_slice(&mono[..n]);
    buffer
}

/// The frame grid for the O(frames × lags) tools (pitch, harmonic ratio): like
/// [`frame_grid`], but the hop is widened so the frame count never exceeds
/// [`MAX_PITCH_FRAMES`], keeping a long window interactive.
fn pitch_grid(len: usize, params: &SharedParams) -> (usize, usize) {
    let fft = params.fft_size();
    let hop = effective_hop(fft, len, params.hop_size(fft));
    let min_hop = len.div_ceil(MAX_PITCH_FRAMES).max(1);
    (fft, hop.max(min_hop))
}

/// The onset-strength envelope for the rhythm tools: half-wave-rectified spectral
/// flux per frame, with the hop widened so the frame count stays bounded.
fn onset_envelope(mono: &[f32], sample_rate: u32, params: &SharedParams) -> (usize, Vec<f32>) {
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let min_hop = mono.len().div_ceil(MAX_RHYTHM_FRAMES).max(1);
    let hop = hop.max(min_hop);
    let buf = mono_buffer(mono, sample_rate);
    let env = oxiaudio::dsp::spectral::spectral_flux(&buf, fft, hop);
    (hop, env)
}

/// Frame start times (seconds) for `frames` frames at `hop` samples.
fn frame_times(frames: usize, hop: usize, sample_rate: u32) -> Vec<f32> {
    let dt = hop.max(1) as f32 / sample_rate.max(1) as f32;
    (0..frames).map(|i| i as f32 * dt).collect()
}

fn build_series(
    times: Vec<f32>,
    values: Vec<Option<f32>>,
    hop: usize,
    sample_rate: u32,
) -> SeriesResult {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
    }
    SeriesResult {
        sample_rate,
        hop_size: hop,
        frames: values.len(),
        times,
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
    }
}

/// Wrap one `f32` value per frame (non-finite values become gaps).
fn series_from_vec(values: Vec<f32>, hop: usize, sample_rate: u32) -> SeriesResult {
    let times = frame_times(values.len(), hop, sample_rate);
    let values = values
        .into_iter()
        .map(|value| value.is_finite().then_some(value))
        .collect();
    build_series(times, values, hop, sample_rate)
}

/// Wrap a pitch track: unvoiced frames become gaps, times come from the tracker,
/// plus the voiced-frame summary so a nearly-empty track is visible at a glance.
fn pitch_series(frames: Vec<PitchFrame>, hop: usize, sample_rate: u32) -> PitchResult {
    let times: Vec<f32> = frames
        .iter()
        .map(|frame| frame.time_seconds as f32)
        .collect();
    let values: Vec<Option<f32>> = frames
        .iter()
        .map(|frame| {
            (frame.is_voiced && frame.frequency_hz.is_finite() && frame.frequency_hz > 0.0)
                .then_some(frame.frequency_hz)
        })
        .collect();
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut voiced_frames = 0usize;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
        voiced_frames += 1;
    }
    let frames_count = values.len();
    PitchResult {
        sample_rate,
        hop_size: hop,
        frames: frames_count,
        times,
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        voiced_frames,
        voiced_fraction: if frames_count == 0 {
            0.0
        } else {
            voiced_frames as f32 / frames_count as f32
        },
    }
}

/// Flatten a `frames × bands` matrix into a [`MatrixResult`].
fn build_matrix(frames: Vec<Vec<f32>>, hop: usize, sample_rate: u32) -> MatrixResult {
    let n_frames = frames.len();
    let bins = frames.first().map(Vec::len).unwrap_or(0);
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut values = Vec::with_capacity(n_frames * bins);
    for frame in &frames {
        for &value in frame {
            let value = if value.is_finite() { value } else { 0.0 };
            min = min.min(value);
            max = max.max(value);
            values.push(value);
        }
    }
    MatrixResult {
        sample_rate,
        hop_size: hop,
        frames: n_frames,
        bins,
        duration: seconds(n_frames * hop.max(1), sample_rate) as f32,
        times: frame_times(n_frames, hop, sample_rate),
        bands: (0..bins).map(|i| i as f32).collect(),
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
    }
}

fn oxi_err(err: oxiaudio::OxiAudioError) -> AnalysisError {
    AnalysisError::Analysis(err.to_string())
}

// --- new tools -----------------------------------------------------------

/// Time-domain level meters: peak / RMS in linear and dBFS.
pub fn levels(mono: &[f32], sample_rate: u32) -> LevelsResult {
    let buf = mono_buffer(mono, sample_rate);
    LevelsResult {
        sample_rate,
        frames: mono.len(),
        duration: seconds(mono.len(), sample_rate),
        peak: buf.peak_amplitude(),
        rms: buf.rms_amplitude(),
        peak_db: db_or_floor(buf.peak_db()),
        rms_db: db_or_floor(buf.rms_db()),
    }
}

/// Log-mel spectrogram (frame × mel band).
pub fn mel_spectrogram(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MatrixResult, AnalysisError> {
    let (fft, hop) = frame_grid(mono.len(), params);
    let buf = mono_buffer(mono, sample_rate);
    let (band_lo, band_hi) = params.band(sample_rate);
    let f_min = options.mel_f_min().unwrap_or(band_lo as f32).max(0.0);
    let f_max = options
        .mel_f_max()
        .unwrap_or(band_hi as f32)
        .max(f_min + 1.0);
    let mel =
        oxiaudio::dsp::spectral::melspectrogram(&buf, options.n_mels(), f_min, f_max, fft, hop)
            .map_err(oxi_err)?;
    Ok(build_matrix(mel, hop, sample_rate))
}

/// Mel-frequency cepstral coefficients (frame × coefficient).
pub fn mfcc(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MatrixResult, AnalysisError> {
    let (fft, hop) = frame_grid(mono.len(), params);
    let buf = mono_buffer(mono, sample_rate);
    let coeffs = oxiaudio::dsp::spectral::mfcc(&buf, options.n_mfcc(), options.n_mels(), fft, hop)
        .map_err(oxi_err)?;
    Ok(build_matrix(coeffs, hop, sample_rate))
}

/// Chromagram (frame × 12 pitch classes).
pub fn chromagram(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<MatrixResult, AnalysisError> {
    let (fft, hop) = frame_grid(mono.len(), params);
    let buf = mono_buffer(mono, sample_rate);
    let frames = oxiaudio::dsp::spectral::chromagram(&buf, fft, hop)
        .into_iter()
        .map(|frame| frame.to_vec())
        .collect();
    Ok(build_matrix(frames, hop, sample_rate))
}

/// Spectral contrast (frame × octave band, in dB).
pub fn spectral_contrast(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MatrixResult, AnalysisError> {
    let (fft, hop) = frame_grid(mono.len(), params);
    let buf = mono_buffer(mono, sample_rate);
    let frames = oxiaudio::dsp::spectral::spectral_contrast(&buf, fft, hop, options.n_bands())
        .map_err(oxi_err)?;
    Ok(build_matrix(frames, hop, sample_rate))
}

/// Dispatch a tool id to its implementation.
pub fn run(
    tool: &str,
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<AnalysisResult, AnalysisError> {
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (pitch_fft, pitch_hop) = pitch_grid(mono.len(), params);
    // The library's frame-based features do not zero-pad, so feed them a padded
    // copy: a window shorter than the FFT still yields a frame. `spectrum` /
    // `spectrogram` and the time-domain / loudness tools keep the original signal.
    let padded;
    let lib_mono: &[f32] = if mono.len() < fft {
        padded = pad_to_fft(mono, fft);
        &padded
    } else {
        mono
    };
    let lib_buf = || mono_buffer(lib_mono, sample_rate);
    match tool {
        "waveform" => Ok(AnalysisResult::Waveform(waveform(mono, sample_rate))),
        "levels" => Ok(AnalysisResult::Levels(levels(mono, sample_rate))),
        "spectrum" => Ok(AnalysisResult::Spectrum(spectrum(
            mono,
            sample_rate,
            params,
        )?)),
        "spectrogram" => Ok(AnalysisResult::Spectrogram(spectrogram(
            mono,
            sample_rate,
            params,
        )?)),
        "melSpectrogram" => Ok(AnalysisResult::MelSpectrogram(mel_spectrogram(
            lib_mono,
            sample_rate,
            params,
            options,
        )?)),
        "mfcc" => Ok(AnalysisResult::Mfcc(mfcc(
            lib_mono,
            sample_rate,
            params,
            options,
        )?)),
        "chromagram" => Ok(AnalysisResult::Chromagram(chromagram(
            lib_mono,
            sample_rate,
            params,
        )?)),
        "spectralContrast" => Ok(AnalysisResult::SpectralContrast(spectral_contrast(
            lib_mono,
            sample_rate,
            params,
            options,
        )?)),
        "spectralCentroid" => Ok(AnalysisResult::SpectralCentroid(series_from_vec(
            oxiaudio::dsp::spectral::spectral_centroid(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralFlux" => Ok(AnalysisResult::SpectralFlux(series_from_vec(
            oxiaudio::dsp::spectral::spectral_flux(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralRolloff" => Ok(AnalysisResult::SpectralRolloff(series_from_vec(
            oxiaudio::dsp::spectral::spectral_rolloff(
                &lib_buf(),
                fft,
                hop,
                options.rolloff_percent(),
            ),
            hop,
            sample_rate,
        ))),
        "spectralFlatness" => Ok(AnalysisResult::SpectralFlatness(series_from_vec(
            oxiaudio::dsp::spectral::spectral_flatness(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralBandwidth" => Ok(AnalysisResult::SpectralBandwidth(series_from_vec(
            oxiaudio::dsp::spectral::spectral_bandwidth(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralEntropy" => Ok(AnalysisResult::SpectralEntropy(series_from_vec(
            oxiaudio::dsp::spectral::spectral_entropy(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralCrest" => Ok(AnalysisResult::SpectralCrest(series_from_vec(
            oxiaudio::dsp::spectral::spectral_crest_factor(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "harmonicRatio" => Ok(AnalysisResult::HarmonicRatio(series_from_vec(
            oxiaudio::dsp::spectral::harmonic_ratio(
                &lib_buf(),
                pitch_fft,
                pitch_hop,
                options.min_f0_hz(),
                options.max_f0_hz(),
            ),
            pitch_hop,
            sample_rate,
        ))),
        "zeroCrossingRate" => Ok(AnalysisResult::ZeroCrossingRate(series_from_vec(
            oxiaudio::dsp::spectral::zero_crossing_rate(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "pitchPyin" => Ok(AnalysisResult::PitchPyin(pitch_series(
            oxiaudio::dsp::detect_pitch_pyin(&lib_buf(), pitch_fft, pitch_hop),
            pitch_hop,
            sample_rate,
        ))),
        "pitchYin" => Ok(AnalysisResult::PitchYin(pitch_series(
            oxiaudio::dsp::detect_pitch_yin(
                &lib_buf(),
                pitch_fft,
                pitch_hop,
                options.yin_threshold(),
            ),
            pitch_hop,
            sample_rate,
        ))),
        "pitchAutocorr" => Ok(AnalysisResult::PitchAutocorr(pitch_series(
            oxiaudio::dsp::detect_pitch_autocorr(
                &lib_buf(),
                pitch_fft,
                pitch_hop,
                options.min_f0_hz(),
                options.max_f0_hz(),
            ),
            pitch_hop,
            sample_rate,
        ))),
        "tempo" => {
            let (env_hop, onset_strength) = onset_envelope(lib_mono, sample_rate, params);
            let est = oxiaudio::dsp::estimate_tempo(&lib_buf(), fft, hop).map_err(oxi_err)?;
            Ok(AnalysisResult::Tempo(RhythmResult {
                bpm: est.bpm,
                confidence: est.confidence,
                hop_size: env_hop,
                times: frame_times(onset_strength.len(), env_hop, sample_rate),
                onset_strength,
                onset_times: vec![],
                beat_times: est.beat_times.iter().map(|&t| t as f32).collect(),
                downbeat_times: vec![],
            }))
        }
        "onsets" => {
            let (env_hop, onset_strength) = onset_envelope(lib_mono, sample_rate, params);
            let times = oxiaudio::dsp::detect_onsets(&lib_buf(), fft, hop).map_err(oxi_err)?;
            Ok(AnalysisResult::Onsets(RhythmResult {
                bpm: 0.0,
                confidence: 0.0,
                hop_size: env_hop,
                times: frame_times(onset_strength.len(), env_hop, sample_rate),
                onset_strength,
                onset_times: times.iter().map(|&t| t as f32).collect(),
                beat_times: vec![],
                downbeat_times: vec![],
            }))
        }
        "downbeats" => {
            let (env_hop, onset_strength) = onset_envelope(lib_mono, sample_rate, params);
            let est = oxiaudio::dsp::estimate_tempo(&lib_buf(), fft, hop).map_err(oxi_err)?;
            let downbeats = oxiaudio::dsp::detect_downbeats(
                &lib_buf(),
                &est.beat_times,
                est.bpm,
                options.bar_length(),
            );
            Ok(AnalysisResult::Downbeats(RhythmResult {
                bpm: est.bpm,
                confidence: est.confidence,
                hop_size: env_hop,
                times: frame_times(onset_strength.len(), env_hop, sample_rate),
                onset_strength,
                onset_times: vec![],
                beat_times: est.beat_times.iter().map(|&t| t as f32).collect(),
                downbeat_times: downbeats.iter().map(|&t| t as f32).collect(),
            }))
        }
        "loudnessIntegrated" => {
            let lufs = oxiaudio::dsp::loudness_lufs(&lib_buf());
            Ok(AnalysisResult::LoudnessIntegrated(LufsResult {
                lufs: if lufs.is_finite() { lufs } else { DB_FLOOR },
            }))
        }
        "loudnessMomentary" => {
            let buf = lib_buf();
            let (values, hop_samples) = match options.window_ms() {
                Some(ms) => (
                    oxiaudio::dsp::loudness_momentary_windowed(&buf, ms),
                    (sample_rate as u64 * ms as u64 / 1000) as usize,
                ),
                None => (
                    oxiaudio::dsp::loudness_momentary(&buf),
                    (sample_rate as usize / 10).max(1),
                ),
            };
            let times = frame_times(values.len(), hop_samples, sample_rate);
            let values = values
                .into_iter()
                .map(|value| value.is_finite().then_some(value))
                .collect();
            Ok(AnalysisResult::LoudnessMomentary(build_series(
                times,
                values,
                hop_samples,
                sample_rate,
            )))
        }
        "loudnessRange" => {
            let lra = oxiaudio::dsp::loudness_range(&lib_buf());
            Ok(AnalysisResult::LoudnessRange(LraResult {
                lra: if lra.is_finite() { lra } else { 0.0 },
            }))
        }
        other => Err(AnalysisError::UnknownTool(other.to_string())),
    }
}

// --- helpers -------------------------------------------------------------

/// The default band (`freq_max_hz ≤ 0`) is filled in with the Nyquist here so the
/// tools can band-limit without each re-deriving it.
fn effective_params(params: &SharedParams, sample_rate: u32) -> SharedParams {
    let mut params = params.clone();
    if !(params.freq_max_hz.is_finite() && params.freq_max_hz > 0.0) {
        params.freq_max_hz = f64::from(sample_rate) / 2.0;
    }
    params
}

/// The hop actually used: the requested hop, raised if it would produce an
/// unbounded STFT frame matrix for a long window (the effective hop is reported
/// back in the result so the UI shows the truth).
fn effective_hop(fft: usize, len: usize, requested: usize) -> usize {
    let requested = requested.max(1);
    if len <= fft {
        return requested;
    }
    let bins = fft / 2 + 1;
    let max_frames = (MAX_STFT_CELLS / bins).max(1);
    let needed = (len - fft).div_ceil(max_frames.saturating_sub(1).max(1));
    requested.max(needed)
}

/// STFT magnitudes per frame (`frames[t][k]`, `k` in `0..=fft/2`).
///
/// When `randomized_overlap` is set, a second STFT is taken half a hop off and the
/// magnitudes are averaged in, breaking the fixed frame-grid alignment (the
/// `stft` batch API exposes no jitter option itself).
fn stft_magnitudes(
    mono: &[f32],
    sample_rate: u32,
    fft: usize,
    hop: usize,
    params: &SharedParams,
) -> Result<(Vec<Vec<f32>>, usize), AnalysisError> {
    let bins = fft / 2 + 1;
    let window = params.window_fn.to_window_fn();
    // Scale magnitudes so a full-scale sine peaks near 0 dBFS regardless of the
    // FFT size / window (`stft` returns unnormalized transform output).
    let gain = (2.0 / window_gain(params.window_fn, fft)) as f32;

    let frame_mags = |samples: &[f32]| -> Result<Vec<Vec<f32>>, AnalysisError> {
        let buf = mono_buffer(samples, sample_rate);
        let out =
            stft(&buf, fft, hop, window).map_err(|err| AnalysisError::Analysis(err.to_string()))?;
        Ok(out
            .frames
            .iter()
            .map(|frame| {
                frame
                    .iter()
                    .take(bins)
                    .map(|c| (c.re * c.re + c.im * c.im).sqrt() * gain)
                    .collect()
            })
            .collect())
    };

    // Zero-pad a window shorter than the FFT so it still yields one frame.
    let padded;
    let signal: &[f32] = if mono.len() < fft {
        padded = {
            let mut buffer = vec![0.0f32; fft];
            buffer[..mono.len()].copy_from_slice(mono);
            buffer
        };
        &padded
    } else {
        mono
    };

    let mut mags = frame_mags(signal)?;
    if params.randomized_overlap && !mags.is_empty() {
        let shift = (hop / 2).max(1);
        // The shifted pass needs a full window of its own to yield frames.
        if signal.len() > shift + fft {
            let shifted = frame_mags(&signal[shift..])?;
            for (frame, other) in mags.iter_mut().zip(shifted.iter()) {
                for (bin, other_bin) in frame.iter_mut().zip(other.iter()) {
                    *bin = 0.5 * (*bin + *other_bin);
                }
            }
        }
    }
    let frames = mags.len();
    Ok((mags, frames))
}

/// Coherent gain (∑ of the window coefficients) for the standard window formulas,
/// used to normalize STFT magnitudes to an amplitude scale.
fn window_gain(kind: WindowKind, n: usize) -> f64 {
    if n == 0 {
        return 1.0;
    }
    let n_minus_1 = (n - 1).max(1) as f64;
    let tau = std::f64::consts::TAU;
    match kind {
        WindowKind::Rectangular => n as f64,
        WindowKind::Hann => (0..n)
            .map(|i| 0.5 - 0.5 * (tau * i as f64 / n_minus_1).cos())
            .sum(),
        WindowKind::Hamming => (0..n)
            .map(|i| 0.54 - 0.46 * (tau * i as f64 / n_minus_1).cos())
            .sum(),
        WindowKind::Blackman => (0..n)
            .map(|i| {
                let x = tau * i as f64 / n_minus_1;
                0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos()
            })
            .sum(),
    }
}

/// Min/max envelope over `samples`, targeting `buckets` buckets.
fn envelope(samples: &[f32], buckets: usize) -> (Vec<f32>, Vec<f32>) {
    if samples.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let step = samples.len().div_ceil(buckets.max(1)).max(1);
    let count = samples.len().div_ceil(step);
    let mut min = Vec::with_capacity(count);
    let mut max = Vec::with_capacity(count);
    for chunk in samples.chunks(step) {
        let mut lo = 1.0f32;
        let mut hi = -1.0f32;
        for &value in chunk {
            if value < lo {
                lo = value;
            }
            if value > hi {
                hi = value;
            }
        }
        if lo > hi {
            lo = 0.0;
            hi = 0.0;
        }
        min.push(lo);
        max.push(hi);
    }
    (min, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn sine(hz: f32, seconds: f32) -> Vec<f32> {
        let frames = (seconds * RATE as f32) as usize;
        (0..frames)
            .map(|i| 0.5 * (std::f32::consts::TAU * hz * i as f32 / RATE as f32).sin())
            .collect()
    }

    fn params(fft_size: usize) -> SharedParams {
        SharedParams {
            fft_size,
            hop: 0.25,
            randomized_overlap: false,
            window_fn: WindowKind::Hann,
            channel: None,
            resample_to: None,
            freq_min_hz: 0.0,
            freq_max_hz: 0.0,
        }
    }

    #[test]
    fn waveform_reports_half_scale_sine() {
        let mono = sine(1_000.0, 0.5);
        let result = waveform(&mono, RATE);
        assert_eq!(result.frames, mono.len());
        assert!((result.peak - 0.5).abs() < 0.02, "peak = {}", result.peak);
        // A full-scale sine has RMS = peak / sqrt(2).
        assert!(
            (result.rms - 0.5 / 2f32.sqrt()).abs() < 0.02,
            "rms = {}",
            result.rms
        );
        assert!(!result.min.is_empty() && result.min.len() == result.max.len());
    }

    #[test]
    fn spectrum_peaks_at_the_sine_frequency() {
        let mono = sine(1_000.0, 0.5);
        let result = spectrum(&mono, RATE, &params(4096)).expect("spectrum");
        assert!(!result.freqs.is_empty());
        assert!(
            (result.peak_hz - 1_000.0).abs() < 30.0,
            "peak_hz = {}",
            result.peak_hz
        );
        // A half-scale sine reads about −6 dBFS after normalization.
        assert!(
            (result.peak_db + 6.0).abs() < 3.0,
            "peak_db = {}",
            result.peak_db
        );
        // The per-bin min / max layers bracket the mean, one entry per bin.
        assert_eq!(result.min_db.len(), result.freqs.len());
        assert_eq!(result.max_db.len(), result.freqs.len());
        for k in 0..result.freqs.len() {
            assert!(
                result.min_db[k] <= result.mag_db[k] + 1e-3
                    && result.mag_db[k] <= result.max_db[k] + 1e-3,
                "bin {k}: min {} mean {} max {}",
                result.min_db[k],
                result.mag_db[k],
                result.max_db[k]
            );
        }
    }

    #[test]
    fn spectrum_respects_the_band_limit() {
        let mono = sine(1_000.0, 0.5);
        let mut p = params(4096);
        p.freq_min_hz = 2_000.0;
        p.freq_max_hz = 4_000.0;
        let result = spectrum(&mono, RATE, &p).expect("spectrum");
        assert!(result
            .freqs
            .iter()
            .all(|&f| (2_000.0..=4_000.0).contains(&f)));
    }

    #[test]
    fn spectrogram_has_matching_dimensions() {
        let mono = sine(1_000.0, 0.5);
        let result = spectrogram(&mono, RATE, &params(1024)).expect("spectrogram");
        assert_eq!(result.bins, result.freqs.len());
        assert_eq!(result.mag_db.len(), result.frames * result.bins);
        assert!(result.max_db >= result.min_db);
    }

    #[test]
    fn condition_mixdowns_then_filters() {
        // Stereo region, downmix of two channels, then identity (no filter).
        let region = vec![1.0, 0.0, 0.0, 1.0, 0.5, 0.5, -0.5, -0.5];
        let (mono, rate) = condition(&region, 2, RATE, None, None, None).expect("condition");
        assert_eq!(rate, RATE);
        assert_eq!(mono, vec![0.5, 0.5, 0.5, -0.5]);
    }

    #[test]
    fn condition_selects_a_channel_and_resamples() {
        // Right channel carries DC 0.9; downsampling keeps the value.
        let region = vec![0.0, 0.9, 0.0, 0.9];
        let (mono, rate) =
            condition(&region, 2, RATE, None, Some(1), Some(24_000)).expect("condition");
        assert_eq!(rate, 24_000);
        assert_eq!(mono.len(), 1);
        assert!((mono[0] - 0.9).abs() < 1e-5, "mono[0] = {}", mono[0]);
    }

    #[test]
    fn long_window_raises_the_hop() {
        // A large FFT over a long buffer widens the fine requested hop to bound memory.
        let fft = 8192;
        let len = 60 * 48_000;
        let hop = effective_hop(fft, len, 512);
        assert!(hop > 512, "hop = {hop}");
        let bins = fft / 2 + 1;
        let frames = (len - fft) / hop + 1;
        assert!(frames * bins <= MAX_STFT_CELLS + bins, "frames = {frames}");
    }

    #[test]
    fn short_buffer_keeps_the_requested_hop() {
        assert_eq!(effective_hop(2048, 1_000, 512), 512);
    }

    #[test]
    fn short_window_is_zero_padded() {
        // Fewer samples than the FFT still yields one (zero-padded) frame.
        let mono = sine(1_000.0, 0.005);
        let result = spectrum(&mono, RATE, &params(2048)).expect("spectrum");
        assert!(result.frames >= 1, "frames = {}", result.frames);
        assert!(!result.freqs.is_empty());
    }

    #[test]
    fn unknown_tool_is_an_error() {
        assert!(matches!(
            run("nope", &[0.0], RATE, &params(1024), &ToolOptions::default()),
            Err(AnalysisError::UnknownTool(_))
        ));
    }

    #[test]
    fn level_meters_match_the_waveform_readouts() {
        let mono = sine(1_000.0, 0.5);
        let result = levels(&mono, RATE);
        assert_eq!(result.frames, mono.len());
        assert!((result.peak - 0.5).abs() < 0.02, "peak = {}", result.peak);
        assert!(
            (result.peak_db + 6.0).abs() < 1.0,
            "peak_db = {}",
            result.peak_db
        );
    }

    #[test]
    fn spectral_features_return_one_value_per_frame() {
        let mono = sine(1_000.0, 0.5);
        let p = params(2048);
        let options = ToolOptions::default();
        let centroid = run("spectralCentroid", &mono, RATE, &p, &options).expect("centroid");
        match centroid {
            AnalysisResult::SpectralCentroid(series) => {
                assert!(series.frames > 0);
                assert_eq!(series.values.len(), series.frames);
                assert_eq!(series.times.len(), series.frames);
                // A 1 kHz sine has its energy near 1 kHz.
                let mean: f32 =
                    series.values.iter().flatten().copied().sum::<f32>() / series.frames as f32;
                assert!((mean - 1_000.0).abs() < 120.0, "mean centroid = {mean}");
            }
            other => panic!("unexpected result: {other:?}"),
        }
    }

    #[test]
    fn chromagram_has_twelve_bands() {
        let mono = sine(440.0, 0.5);
        let result = chromagram(&mono, RATE, &params(2048)).expect("chromagram");
        assert_eq!(result.bins, 12);
        assert_eq!(result.values.len(), result.frames * 12);
    }

    #[test]
    fn pitch_marks_unvoiced_frames_as_gaps() {
        // A pure tone is voiced; the tail (silence) should not be.
        let mut mono = sine(440.0, 0.5);
        mono.extend(std::iter::repeat_n(0.0, RATE as usize / 4));
        let result = match run(
            "pitchPyin",
            &mono,
            RATE,
            &params(2048),
            &ToolOptions::default(),
        )
        .expect("pitch")
        {
            AnalysisResult::PitchPyin(series) => series,
            other => panic!("unexpected result: {other:?}"),
        };
        assert!(result.frames > 0);
        let voiced = result.values.iter().flatten().count();
        assert!(voiced > 0, "expected some voiced frames");
        assert!(voiced < result.frames, "expected some silent gaps");
        // The voiced summary matches the values, so a near-empty track is visible
        // without scanning the series.
        assert_eq!(result.voiced_frames, voiced);
        let expected = voiced as f32 / result.frames as f32;
        assert!(
            (result.voiced_fraction - expected).abs() < 1e-6,
            "voiced_fraction = {}",
            result.voiced_fraction
        );
    }

    #[test]
    fn loudness_tools_return_finite_values() {
        let mono = sine(1_000.0, 1.0);
        match run(
            "loudnessIntegrated",
            &mono,
            RATE,
            &params(2048),
            &ToolOptions::default(),
        )
        .expect("lufs")
        {
            AnalysisResult::LoudnessIntegrated(result) => {
                assert!(result.lufs.is_finite(), "lufs = {}", result.lufs);
            }
            other => panic!("unexpected result: {other:?}"),
        }
    }

    #[test]
    fn tempo_and_onsets_run_without_error() {
        let mono = sine(1_000.0, 1.0);
        let options = ToolOptions::default();
        assert!(run("tempo", &mono, RATE, &params(2048), &options).is_ok());
        assert!(run("onsets", &mono, RATE, &params(2048), &options).is_ok());
        assert!(run("downbeats", &mono, RATE, &params(2048), &options).is_ok());
    }

    #[test]
    fn short_window_pads_library_tools() {
        // A handful of samples: the library's frame-based features (unlike our STFT)
        // do not pad, so without padding these would come back empty.
        let mono: Vec<f32> = vec![0.1, -0.1, 0.05, -0.05, 0.2, -0.2, 0.1, -0.1];
        let p = params(2048);
        let options = ToolOptions::default();
        match run("chromagram", &mono, RATE, &p, &options).expect("chromagram") {
            AnalysisResult::Chromagram(r) => {
                assert!(r.frames >= 1, "frames = {}", r.frames);
                assert_eq!(r.bins, 12);
            }
            other => panic!("unexpected result: {other:?}"),
        }
        match run("spectralCentroid", &mono, RATE, &p, &options).expect("centroid") {
            AnalysisResult::SpectralCentroid(r) => {
                assert!(r.frames >= 1, "frames = {}", r.frames)
            }
            other => panic!("unexpected result: {other:?}"),
        }
    }

    #[test]
    fn pitch_frames_are_capped() {
        // A long window keeps the O(frames × lags) pitch tools bounded.
        let mono = sine(440.0, 30.0);
        let pitch = match run(
            "pitchYin",
            &mono,
            RATE,
            &params(2048),
            &ToolOptions::default(),
        )
        .expect("pitch")
        {
            AnalysisResult::PitchYin(r) => r,
            other => panic!("unexpected result: {other:?}"),
        };
        assert!(pitch.frames > 0);
        assert!(
            pitch.frames <= MAX_PITCH_FRAMES,
            "frames = {}",
            pitch.frames
        );
    }

    #[test]
    fn rhythm_result_carries_the_envelope() {
        let mono = sine(1_000.0, 1.0);
        let r = match run(
            "onsets",
            &mono,
            RATE,
            &params(2048),
            &ToolOptions::default(),
        )
        .expect("onsets")
        {
            AnalysisResult::Onsets(r) => r,
            other => panic!("unexpected result: {other:?}"),
        };
        assert!(!r.onset_strength.is_empty());
        assert_eq!(r.times.len(), r.onset_strength.len());
    }
}
