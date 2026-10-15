//! Input types for the analysis engine: the window function, the shared params,
//! the per-tool options, and the engine error. See `docs/data-model.md` and
//! `docs/analysis-tools.md`.

use oxiaudio::dsp::spectral::WindowFn;
use serde::{Deserialize, Serialize};

use super::{
    DEFAULT_BAR_LENGTH, DEFAULT_MAX_F0, DEFAULT_MIN_F0, DEFAULT_N_BANDS, DEFAULT_N_MELS,
    DEFAULT_N_MFCC, DEFAULT_ROLLOFF, DEFAULT_YIN_THRESHOLD,
};

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
    pub(super) fn to_window_fn(self) -> WindowFn {
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
    /// Optional overlap randomization (see [`super::support::stft_magnitudes`]).
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
    pub(super) fn fft_size(&self) -> usize {
        self.fft_size.clamp(64, 32_768)
    }

    /// The hop converted to samples (≥ 1) for `fft`.
    pub(super) fn hop_size(&self, fft: usize) -> usize {
        let hop = if self.hop.is_finite() { self.hop } else { 0.25 };
        ((fft as f64) * hop.clamp(0.01, 1.0)).round().max(1.0) as usize
    }

    /// The band-limit range clamped to `[0, nyquist]`.
    pub(super) fn band(&self, sample_rate: u32) -> (f64, f64) {
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
    pub(super) fn n_mels(&self) -> usize {
        self.n_mels.unwrap_or(DEFAULT_N_MELS).clamp(8, 256)
    }

    pub(super) fn n_mfcc(&self) -> usize {
        self.n_mfcc.unwrap_or(DEFAULT_N_MFCC).clamp(1, 64)
    }

    pub(super) fn n_bands(&self) -> usize {
        self.n_bands.unwrap_or(DEFAULT_N_BANDS).clamp(2, 16)
    }

    pub(super) fn rolloff_percent(&self) -> f32 {
        self.rolloff_percent
            .unwrap_or(DEFAULT_ROLLOFF)
            .clamp(0.01, 0.99)
    }

    pub(super) fn yin_threshold(&self) -> f32 {
        self.yin_threshold
            .unwrap_or(DEFAULT_YIN_THRESHOLD)
            .clamp(0.01, 0.9)
    }

    pub(super) fn min_f0_hz(&self) -> f32 {
        self.min_f0_hz.unwrap_or(DEFAULT_MIN_F0).max(1.0)
    }

    pub(super) fn max_f0_hz(&self) -> f32 {
        self.max_f0_hz
            .unwrap_or(DEFAULT_MAX_F0)
            .max(self.min_f0_hz() + 1.0)
    }

    pub(super) fn bar_length(&self) -> usize {
        self.bar_length.unwrap_or(DEFAULT_BAR_LENGTH).clamp(2, 12)
    }

    pub(super) fn window_ms(&self) -> Option<u32> {
        self.window_ms.filter(|&ms| ms > 0)
    }

    pub(super) fn mel_f_min(&self) -> Option<f32> {
        self.f_min_hz.filter(|&f| f > 0.0)
    }

    pub(super) fn mel_f_max(&self) -> Option<f32> {
        self.f_max_hz.filter(|&f| f > 0.0)
    }
}
