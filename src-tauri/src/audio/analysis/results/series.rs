//! The scalar-per-frame series result and its window gate (M21.B), split out of
//! [`super`] to keep each file inside the source-size budget.

use serde::Serialize;

/// The window gate a series measurement ran with (M21.B).
///
/// Gating excludes frames far below the window's loudest frame by turning their
/// `values` entry into a gap, so a measurement is not polluted by a recording's
/// pre-roll or background. The effective gate is echoed here and in the summary.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SeriesGate {
    /// How far below the window peak a frame must sit to be excluded, in dB.
    pub gate_db: f32,
    /// The absolute dBFS floor the gate never goes below.
    pub gate_floor_db: f32,
    /// The effective threshold: `max(gate_floor_db, windowPeakDb − gate_db)`.
    pub threshold_db: f32,
    /// Frames excluded by the gate (their `values` entry is `null`).
    pub gated_frames: usize,
    /// Frames that passed the gate.
    pub kept_frames: usize,
}

/// One scalar value per analysis frame, plotted against time. `values` may contain
/// gaps (`None`) — e.g. unvoiced pitch frames or silent loudness blocks.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SeriesResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    /// Frame times in **source seconds**.
    pub times: Vec<f32>,
    /// Source seconds where the window starts (`times[0]` is at or after this).
    pub window_start: f64,
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    /// The RMS frame length in samples, for tools that measure per frame (`frameRms`).
    /// Absent for tools whose frames are defined by the shared FFT size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frame_size: Option<usize>,
    /// The window gate this measurement ran with (M21.B); absent when gating is off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub gate: Option<SeriesGate>,
}
