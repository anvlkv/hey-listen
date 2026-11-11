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
    /// The loudness model this run implements (e.g. "Moore–Glasberg / ISO 532-2 family approximation").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    /// The standard the model approximates (e.g. "ISO 532-2").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub standard: Option<String>,
    /// Per-frame RMS level in **dBFS**, parallel to `times` (same hop and frame grid).
    /// A silent frame is floored, never `-inf`.
    /// (Optional on the TS wire: `serde`'s `default` + `skip_serializing_if` makes
    /// `ts-rs` emit the field as optional; it rejects bare `#[ts(optional)]` on a `Vec`.)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frame_rms_db: Vec<Option<f32>>,
    /// The same frames as absolute dB SPL (`frame_rms_db + calibration_db_spl`) when the
    /// run is calibrated; empty when it is not, so no absolute level is invented.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frame_spl_db: Vec<Option<f32>>,
}
