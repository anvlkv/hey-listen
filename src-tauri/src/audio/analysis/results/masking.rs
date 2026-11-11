//! The `masking` result (M30): the spectrum with its threshold in quiet, global
//! masking threshold, and signal-to-mask ratio.
//!
//! Every array shares the `freqs` axis. `spectrum_db` is the line level `L(i)` — dB SPL
//! when the run was calibrated, dBFS otherwise — while `threshold_quiet_db` is always
//! dB SPL. `global_mask_db` and `smr_db` follow the spectrum's unit: a calibrated run
//! folds in `Tq`, an uncalibrated run sums the maskers alone, so without `calibrated`
//! the SMR is a relative margin, not an audibility verdict.

use serde::{Deserialize, Serialize};

/// One masker the model spread over the Bark axis (M36 drill-down).
///
/// The model sums these into `global_mask_db`; naming them lets a reader see *what*
/// masks a line instead of only the resulting threshold. The kind is a `bool` because
/// there are exactly two: a tonal component or the residual (non-tonal) energy.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MaskerInfo {
    /// The masker's centre frequency (Hz), converted back from its Bark position.
    pub hz: f32,
    /// The masker's level in `spectrum_db`'s unit — a tonal masker's summed main lobe,
    /// or a residual band's summed power.
    pub level_db: f32,
    /// Tonal (true) or residual/non-tonal (false).
    pub tonal: bool,
}

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
    /// `Tg(i)` — the global masking threshold, in `spectrum_db`'s unit. It includes the
    /// dB SPL threshold in quiet only when `calibrated`; otherwise it is relative.
    pub global_mask_db: Vec<f32>,
    /// `SMR(i) = L(i) − Tg(i)` (positive = above the estimated threshold). Only a
    /// calibrated result supports an audibility reading.
    pub smr_db: Vec<f32>,
    /// Whether a positive calibration was supplied, so `spectrum_db` is dB SPL.
    pub calibrated: bool,
    /// The dB SPL of a full-scale sine the run assumed (`0` = uncalibrated).
    pub calibration_db_spl: f32,
    /// The maskers behind `global_mask_db`, tonal ones first, then the residual bands
    /// (M36 drill-down). Empty for a stored result written before the field existed.
    #[serde(default)]
    pub maskers: Vec<MaskerInfo>,
}
