//! The `loudness` result summary (M27), split out of [`super::families`] for the
//! source-size budget.

use super::SummaryBuilder;
use crate::audio::analysis::psychoacoustics::loudness::sone_to_phon;
use crate::audio::analysis::LoudnessResult;

/// The sone N5 / mean / max, the N5 in phons, and the calibration state.
pub(super) fn loudness(b: &mut SummaryBuilder, r: &LoudnessResult) {
    b.count("frames", "frames", r.times.len());
    let mut present: Vec<f64> = r
        .loudness_sone
        .iter()
        .flatten()
        .filter(|value| value.is_finite())
        .map(|value| f64::from(*value))
        .collect();
    let max = present.iter().copied().reduce(f64::max).unwrap_or(0.0);
    let mean = if present.is_empty() {
        0.0
    } else {
        present.iter().sum::<f64>() / present.len() as f64
    };
    // N5 is the loudness exceeded 5% of the time (the 95th percentile): sort
    // descending and take index floor(0.05 (n − 1)).
    present.sort_by(|a, b| b.total_cmp(a));
    let index = if present.is_empty() {
        0
    } else {
        (0.05 * (present.len() - 1) as f64).floor() as usize
    };
    let n5 = present.get(index).copied().unwrap_or(0.0);
    b.push("n5Sone", "N5", n5, Some("sone"));
    b.push("meanSone", "mean", mean, Some("sone"));
    b.push("maxSone", "max", max, Some("sone"));
    b.push(
        "n5Phon",
        "N5 level",
        f64::from(sone_to_phon(n5 as f32)),
        Some("phon"),
    );
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
