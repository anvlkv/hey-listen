//! The result builder shared by `roughness` and `fluctuationStrength` (M29/M36), split
//! out of `modulation.rs` for the source-size budget.

use super::super::super::support::frame_times;
use super::super::super::{CalibratedSeriesResult, Contribution, RateContribution};
use super::Modulation;

/// A `CalibratedSeriesResult` over the frames of `modulation`, recording the calibration
/// and attaching the per-band contribution grid and, when the tool collected one, the
/// band × modulation-rate matrix (M36).
///
/// Each contribution cell is a band's share of that frame's value, **after** the tool's
/// `scale` and the level `gain`: `scale · gain · weight_b · depth_b^e · g(z_b)^e · ρ_b^e`.
/// The columns therefore sum to the frame's scalar in `values`, so the grid both
/// decomposes the value and reproduces it (up to summation order). `unit` is the tool's
/// own (`asper` for roughness, `vacil` for fluctuation strength).
pub(crate) fn series(
    modulation: Modulation,
    sample_rate: u32,
    calibration_db_spl: f32,
    unit: &str,
) -> CalibratedSeriesResult {
    let Modulation {
        hop,
        values,
        bands,
        contributions,
        rates,
        rate_values,
    } = modulation;
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
    }
    let times = frame_times(values.len(), hop, sample_rate);
    // The rate matrix is a separate axis over the same frames; its cell values are not
    // part of the scalar (see `rates`), so it is attached as its own payload.
    let rate_contribution = (!rate_values.is_empty()).then(|| RateContribution {
        frames: values.len(),
        bands: bands.len(),
        rates: rates.len(),
        band_hz: bands.clone(),
        rate_hz: rates,
        values: rate_values,
    });
    let contribution = Contribution {
        frames: values.len(),
        bins: bands.len(),
        times: times.clone(),
        bands,
        values: contributions,
        label: "band modulation".to_string(),
        unit: Some(unit.to_string()),
    };
    CalibratedSeriesResult {
        sample_rate,
        hop_size: hop,
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        times,
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        calibrated: calibration_db_spl > 0.0,
        calibration_db_spl,
        contribution: Some(contribution),
        rate_contribution,
    }
}
