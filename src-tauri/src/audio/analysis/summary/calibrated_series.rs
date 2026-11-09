//! Calibrated scalar-series summary items (M28/M29), split out of [`super::families`]
//! for the source-size budget.

use super::SummaryBuilder;
use crate::audio::analysis::CalibratedSeriesResult;
use crate::audio::analyzers::AnalyzerId;

/// A calibrated scalar series: the value extents in the tool's unit plus the
/// calibration state, so an uncalibrated result is never read as absolute.
pub(super) fn calibrated_series(
    b: &mut SummaryBuilder,
    tool: AnalyzerId,
    r: &CalibratedSeriesResult,
) {
    let unit = match tool {
        AnalyzerId::Sharpness => "acum",
        AnalyzerId::Roughness => "asper",
        AnalyzerId::FluctuationStrength => "vacil",
        // `tonality` is a dimensionless 0…1 ratio proxy.
        AnalyzerId::Tonality => "",
        _ => "",
    };
    let unit = (!unit.is_empty()).then_some(unit);
    b.count("frames", "frames", r.values.len());
    push_series_extents(b, &r.times, &r.values, unit);
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

/// The extents of a gapped series and the times they occur at.
pub(super) fn push_series_extents(
    b: &mut SummaryBuilder,
    times: &[f32],
    values: &[Option<f32>],
    unit: Option<&'static str>,
) {
    let mut min: Option<(f64, f64)> = None;
    let mut max: Option<(f64, f64)> = None;
    for (index, value) in values.iter().enumerate() {
        let Some(value) = value else { continue };
        let value = f64::from(*value);
        let time = times.get(index).map_or(0.0, |t| f64::from(*t));
        if min.is_none_or(|(current, _)| value < current) {
            min = Some((value, time));
        }
        if max.is_none_or(|(current, _)| value > current) {
            max = Some((value, time));
        }
    }
    if let Some((value, _)) = min {
        b.push("min", "min", value, unit);
    }
    if let Some((value, _)) = max {
        b.push("max", "max", value, unit);
    }
    if let Some((_, time)) = min {
        b.push("minTime", "at", time, Some("s"));
    }
    if let Some((_, time)) = max {
        b.push("maxTime", "at", time, Some("s"));
    }
}
