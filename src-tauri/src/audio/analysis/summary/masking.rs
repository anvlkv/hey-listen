//! The `masking` result summary (M30), split out of [`super::families`] for the
//! source-size budget.

use super::SummaryBuilder;
use crate::audio::analysis::MaskingResult;

/// The grid, the signal-to-mask ratio extents, and the calibration state.
pub(super) fn masking(b: &mut SummaryBuilder, r: &MaskingResult) {
    b.count("fftSize", "FFT size", r.fft_size);
    b.count("frames", "frames", r.frames);
    // The extents are always reported, so the documented key list never depends on
    // whether the window happened to be empty.
    let min = r.smr_db.iter().copied().reduce(f32::min).unwrap_or(0.0);
    let max = r.smr_db.iter().copied().reduce(f32::max).unwrap_or(0.0);
    b.push("minSmrDb", "min SMR", f64::from(min), Some("dB"));
    b.push("maxSmrDb", "max SMR", f64::from(max), Some("dB"));
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
