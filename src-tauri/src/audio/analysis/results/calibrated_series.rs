//! A scalar-per-frame series whose values depend on the loudness calibration (M28).
//!
//! `times` / `values` deliberately mirror [`super::SeriesResult`], so the existing
//! `SeriesView` renders it unchanged; the extra fields record the calibration the
//! values were computed under. The first user is `sharpness`; the perceptual tools that
//! follow (M29–M31) reuse it.

use serde::{Deserialize, Serialize};

/// One calibrated value per analysis frame, plotted against time. A frame with no
/// measurable value is a gap (`None`).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CalibratedSeriesResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    /// Source seconds where the window starts (`times[0]` is at or after this).
    pub window_start: f64,
    /// Frame times in **source seconds**.
    pub times: Vec<f32>,
    /// The measured value per frame (acum for `sharpness`); gaps are `None`.
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    /// Whether a positive calibration was supplied, so the values are absolute.
    pub calibrated: bool,
    /// The dB SPL of a full-scale sine the run assumed (`0` = uncalibrated).
    pub calibration_db_spl: f32,
}
