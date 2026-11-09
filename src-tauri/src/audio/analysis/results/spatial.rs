//! The stereo-cue result (M31): mid/side levels and the normalized inter-channel
//! correlation over time.
//!
//! `times` / `values` deliberately mirror [`super::SeriesResult`], so the existing
//! `SeriesView` renders the correlation track unchanged; `mid_db` / `side_db` are the
//! window-level mid/side RMS readouts. These are **acoustic cues**, not a perceived
//! width model.
//!
//! `calibrated` / `calibration_db_spl` are recorded for provenance and consistency with
//! the other perception results. They do **not** convert the levels to dB SPL: the
//! correlation is unitless and mid/side stay dBFS.

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
    /// Whether a positive calibration was supplied. Recorded for provenance: it does
    /// not scale `mid_db` / `side_db`, which stay dBFS (a stereo cue is an
    /// inter-channel ratio, not an absolute level).
    pub calibrated: bool,
    /// The dB SPL of a full-scale sine the run assumed (`0` = uncalibrated). Kept for
    /// consistency with the other perception results; it does **not** convert the
    /// mid/side levels to dB SPL.
    pub calibration_db_spl: f32,
}
