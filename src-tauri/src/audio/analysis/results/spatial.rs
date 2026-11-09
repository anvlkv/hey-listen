//! The stereo-cue result (M31): mid/side levels and the normalized inter-channel
//! correlation over time.
//!
//! `times` / `values` deliberately mirror [`super::SeriesResult`], so the existing
//! `SeriesView` renders the correlation track unchanged; `mid_db` / `side_db` are the
//! window-level mid/side RMS readouts. These are **acoustic cues**, not a perceived
//! width model.

use serde::{Deserialize, Serialize};

/// The mid/side levels and per-frame inter-channel correlation of a stereo window.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpatialResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    /// Source seconds where the window starts (`times[0]` is at or after this).
    pub window_start: f64,
    /// Frame times in **source seconds**.
    pub times: Vec<f32>,
    /// Normalized inter-channel correlation `ρ` per frame; a silent frame is a gap.
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    /// Mid `(L + R) / 2` RMS over the window, in dBFS (floored at the engine floor).
    pub mid_db: f32,
    /// Side `(L − R) / 2` RMS over the window, in dBFS.
    pub side_db: f32,
    /// Whether a positive calibration was supplied.
    pub calibrated: bool,
    /// The dB SPL of a full-scale sine the run assumed (`0` = uncalibrated).
    pub calibration_db_spl: f32,
}
