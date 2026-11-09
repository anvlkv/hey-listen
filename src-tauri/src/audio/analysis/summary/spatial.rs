//! The stereo-cue summary (M31): the correlation extents plus the window-level
//! mid/side levels and the calibration state.

use super::SummaryBuilder;
use crate::audio::analysis::SpatialResult;

/// A `spatial` result: frame count, mid/side levels in dBFS, the normalized
/// correlation's min/max (unitless), and the calibration state.
pub(super) fn spatial(b: &mut SummaryBuilder, r: &SpatialResult) {
    b.count("frames", "frames", r.values.len());
    b.push("midDb", "mid", f64::from(r.mid_db), Some("dBFS"));
    b.push("sideDb", "side", f64::from(r.side_db), Some("dBFS"));
    let present: Vec<f64> = r.values.iter().flatten().map(|v| f64::from(*v)).collect();
    if let Some(min) = present.iter().copied().reduce(f64::min) {
        b.push("min", "min correlation", min, None);
    }
    if let Some(max) = present.iter().copied().reduce(f64::max) {
        b.push("max", "max correlation", max, None);
    }
    b.push(
        "calibrated",
        "calibrated",
        if r.calibrated { 1.0 } else { 0.0 },
        None,
    );
    b.push(
        "calibrationDbSpl",
        "calibration",
        f64::from(r.calibration_db_spl),
        Some("dB SPL"),
    );
}
