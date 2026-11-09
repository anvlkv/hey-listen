//! The `masking` result (M30): the spectrum with its threshold in quiet, global
//! masking threshold, and signal-to-mask ratio.
//!
//! Every array shares the `freqs` axis. `spectrum_db` is the line level `L(i)` — dB SPL
//! when the run was calibrated, dBFS otherwise — while `threshold_quiet_db` is always
//! dB SPL.

use serde::{Deserialize, Serialize};

/// One averaged spectrum with its masking model.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MaskingResult {
    pub sample_rate: u32,
    pub fft_size: usize,
    /// Number of STFT frames averaged.
    pub frames: usize,
    /// Source seconds where the window starts (the result has no time axis).
    pub window_start: f64,
    /// Bin centre frequencies (Hz) — band-limited.
    pub freqs: Vec<f32>,
    /// `L(i)` — the averaged level per bin (dB SPL when calibrated, else dBFS).
    pub spectrum_db: Vec<f32>,
    /// `Tq(i)` — the threshold in quiet (dB SPL).
    pub threshold_quiet_db: Vec<f32>,
    /// `Tg(i)` — the global masking threshold, in `spectrum_db`'s unit.
    pub global_mask_db: Vec<f32>,
    /// `SMR(i) = L(i) − Tg(i)` (positive = above the estimated threshold).
    pub smr_db: Vec<f32>,
    /// Whether a positive calibration was supplied, so `spectrum_db` is dB SPL.
    pub calibrated: bool,
    /// The dB SPL of a full-scale sine the run assumed (`0` = uncalibrated).
    pub calibration_db_spl: f32,
}
