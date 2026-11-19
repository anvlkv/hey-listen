//! Input types for the analysis engine: the window function, the shared params,
//! the per-tool options, and the engine error. See `docs/data-model.md` and
//! `docs/analysis-tools.md`.

use serde::{Deserialize, Serialize};

mod tool_options;
mod window;
mod wire;

pub use tool_options::{Detrend, ToolOptions};
pub use window::WindowKind;
pub use wire::canonical_option_key;

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
    /// Band limit for **spectral** tools, in Hz (pitch tools use their own f0 range).
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
    /// The run was superseded and stopped at a cancellation check (D-21).
    #[error("cancelled")]
    Cancelled,

    #[error("analysis failed: {0}")]
    Analysis(String),
    #[error("filter graph failed to apply: {0}")]
    Filter(String),
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(AnalysisError);
