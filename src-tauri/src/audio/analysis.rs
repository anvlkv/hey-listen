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

/// A window function for frame-based tools (`docs/analysis-tools.md`).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowKind {
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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
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
impl Serialize for AnalysisError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

// --- results -------------------------------------------------------------

/// Time-domain waveform over the window plus its level readouts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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
    /// Frequency (Hz) and level (dBFS) of the strongest bin.
    pub peak_hz: f32,
    pub peak_db: f32,
}

/// STFT magnitude heatmap over the window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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

/// A tool's result, tagged by the tool id that produced it.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "tool", rename_all = "camelCase")]
pub enum AnalysisResult {
    Waveform(WaveformResult),
    Spectrum(SpectrumResult),
    Spectrogram(SpectrogramResult),
}

// --- signal conditioning -------------------------------------------------

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
    let mut peak_hz = 0.0f32;
    let mut peak_db = DB_FLOOR;
    for k in 0..bins {
        let freq = k as f64 * f64::from(sample_rate) / fft as f64;
        if freq < min_hz || freq > max_hz {
            continue;
        }
        let mean = if frames > 0 {
            mags.iter().map(|frame| frame[k]).sum::<f32>() / frames as f32
        } else {
            0.0
        };
        let db = db_or_floor(20.0 * mean.max(1e-10).log10());
        if db > peak_db {
            peak_db = db;
            peak_hz = freq as f32;
        }
        freqs.push(freq as f32);
        mag_db.push(db);
    }

    Ok(SpectrumResult {
        sample_rate,
        fft_size: fft,
        hop_size: hop,
        frames,
        freqs,
        mag_db,
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

/// Dispatch a tool id to its implementation.
pub fn run(
    tool: &str,
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<AnalysisResult, AnalysisError> {
    match tool {
        "waveform" => Ok(AnalysisResult::Waveform(waveform(mono, sample_rate))),
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
            run("nope", &[0.0], RATE, &params(1024)),
            Err(AnalysisError::UnknownTool(_))
        ));
    }
}
