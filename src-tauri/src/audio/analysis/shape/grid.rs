//! Compact shapes for the nested grids a calibrated series carries (M36), split out of
//! `shape.rs` for the source-size budget.
//!
//! Both grids keep their axes in a compact result — a cell is only interpretable with
//! its band (and, for the rate matrix, its rate) — while the cell array itself becomes
//! `{ length, min, max, argmin, argmax }`. That way a compact result never carries a
//! full `frames × bins` or `frames × bands × rates` array.

use serde_json::Value;

use crate::audio::analysis::{Contribution, RateContribution};

use super::{stats_f32, time_axis};

/// A contribution grid as `{ frames, bins, times, bands, values, label, unit }` with the
/// cell array replaced by its stats. `bands` stays an array: it is one entry per column
/// and is what makes a cell interpretable.
pub(super) fn compact_contribution(contribution: &Contribution) -> Value {
    serde_json::json!({
        "frames": contribution.frames,
        "bins": contribution.bins,
        "times": time_axis(&contribution.times),
        "bands": contribution.bands,
        "values": stats_f32(&contribution.values),
        "label": contribution.label,
        "unit": contribution.unit,
    })
}

/// The band × rate matrix as `{ frames, bands, rates, bandHz, rateHz, values }` with the
/// cell array replaced by its stats; both axes stay arrays so a cell is interpretable.
pub(super) fn compact_rate_contribution(grid: &RateContribution) -> Value {
    serde_json::json!({
        "frames": grid.frames,
        "bands": grid.bands,
        "rates": grid.rates,
        "bandHz": grid.band_hz,
        "rateHz": grid.rate_hz,
        "values": stats_f32(&grid.values),
    })
}
