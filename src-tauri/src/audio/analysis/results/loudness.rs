//! The Moore–Glasberg loudness result (M27), split out of [`super`] for the
//! source-size budget.

use serde::{Deserialize, Serialize};

/// Perceived loudness over time (M27): Moore–Glasberg sones and phons per frame.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LoudnessResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    /// Source seconds where the window starts (frame 0 sits here).
    pub window_start: f64,
    /// Frame times in **source seconds**.
    pub times: Vec<f32>,
    /// Loudness `N` in sones per frame (an unmeasurable frame is a gap).
    pub loudness_sone: Vec<Option<f32>>,
    /// Loudness level `LN` in phons per frame.
    pub loudness_phon: Vec<Option<f32>>,
    /// Whether the input carried a calibration; when false the sones are relative.
    pub calibrated: bool,
    /// The calibration used: the dB SPL of a full-scale sine (`0` = uncalibrated).
    pub calibration_db_spl: f32,
}
