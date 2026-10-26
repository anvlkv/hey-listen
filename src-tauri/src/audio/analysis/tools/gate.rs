//! The window gate for scalar series (M21.B), split out of [`super::super::support`]
//! so each file stays inside the source-size budget.

use super::super::support::db_or_floor;
use super::super::{SeriesGate, SeriesResult, ToolOptions, DB_FLOOR};

/// Per-frame RMS level in dBFS on an analysis grid: frame `i` covers
/// `[i * hop, i * hop + frame)` (the same framing `oxiaudio`'s STFT and autocorrelation
/// tools use), clamped to the signal. Used by [`apply_gate`].
pub(super) fn frame_levels_db(mono: &[f32], frame: usize, hop: usize, count: usize) -> Vec<f32> {
    let frame = frame.max(1);
    let hop = hop.max(1);
    let mut levels = Vec::with_capacity(count);
    for index in 0..count {
        let start = index.saturating_mul(hop).min(mono.len());
        let end = (start + frame).min(mono.len());
        if end <= start {
            levels.push(DB_FLOOR);
            continue;
        }
        let slice = &mono[start..end];
        let sum: f64 = slice.iter().map(|&sample| f64::from(sample).powi(2)).sum();
        let rms = (sum / slice.len() as f64).sqrt() as f32;
        levels.push(if rms > 0.0 {
            db_or_floor(20.0 * rms.log10())
        } else {
            DB_FLOOR
        });
    }
    levels
}

/// Apply the window gate to a series (M21.B): every frame whose level sits below
/// `max(gateFloorDb, windowPeakDb − gateDb)` becomes a gap. Returns the effective gate
/// so it can be echoed in the result and the summary; `None` when gating is off.
pub(super) fn apply_gate(
    result: &mut SeriesResult,
    mono: &[f32],
    frame: usize,
    hop: usize,
    options: &ToolOptions,
) -> Option<SeriesGate> {
    let gate_db = options.series_gate_db()?;
    let gate_floor_db = options.series_gate_floor_db();
    let levels = frame_levels_db(mono, frame, hop, result.frames);
    let peak_db = levels.iter().copied().fold(DB_FLOOR, f32::max);
    let threshold_db = (peak_db - gate_db).max(gate_floor_db);

    let mut gated = 0usize;
    for (value, level) in result.values.iter_mut().zip(&levels) {
        if *level < threshold_db {
            *value = None;
            gated += 1;
        }
    }

    let (mut min, mut max) = (f32::INFINITY, f32::NEG_INFINITY);
    for value in result.values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
    }
    result.min_value = if min.is_finite() { min } else { 0.0 };
    result.max_value = if max.is_finite() { max } else { 0.0 };

    Some(SeriesGate {
        gate_db,
        gate_floor_db,
        threshold_db,
        gated_frames: gated,
        kept_frames: result.frames.saturating_sub(gated),
    })
}
