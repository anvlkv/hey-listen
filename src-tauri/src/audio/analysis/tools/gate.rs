//! The window gate for scalar series (M21.B), split out of [`super::super::support`]
//! so each file stays inside the source-size budget.

use super::super::support::db_or_floor;
use super::super::{CalibratedSeriesResult, SeriesGate, SeriesResult, ToolOptions, DB_FLOOR};
use super::shared::series_extents;

/// Per-frame RMS level in dBFS on an analysis grid: frame `i` covers
/// `[i * hop, i * hop + frame)` (the same framing `oxiaudio`'s STFT and autocorrelation
/// tools use), clamped to the signal. Used by [`gate_values`].
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

/// Apply the window gate to a track (M21.B): every frame whose level sits below
/// `max(gateFloorDb, windowPeakDb − gateDb)` becomes a gap. Returns the effective gate
/// so it can be echoed in the result and the summary; `None` when gating is off.
///
/// The same mask serves a plain [`SeriesResult`] and a [`CalibratedSeriesResult`], so the
/// perceptual tracks reuse one gate implementation.
pub(super) fn gate_values(
    values: &mut [Option<f32>],
    mono: &[f32],
    frame: usize,
    hop: usize,
    options: &ToolOptions,
) -> Option<SeriesGate> {
    let gate_db = options.series_gate_db()?;
    let gate_floor_db = options.series_gate_floor_db();
    let levels = frame_levels_db(mono, frame, hop, values.len());
    let peak_db = levels.iter().copied().fold(DB_FLOOR, f32::max);
    let threshold_db = (peak_db - gate_db).max(gate_floor_db);

    let mut gated = 0usize;
    for (value, level) in values.iter_mut().zip(&levels) {
        if *level < threshold_db {
            *value = None;
            gated += 1;
        }
    }

    Some(SeriesGate {
        gate_db,
        gate_floor_db,
        threshold_db,
        gated_frames: gated,
        kept_frames: values.len().saturating_sub(gated),
    })
}

/// The value column and extents a gated series exposes, so [`apply_gate`] serves a plain
/// [`SeriesResult`] and a [`CalibratedSeriesResult`] alike.
pub(super) trait GatedSeries {
    fn gated_values(&mut self) -> &mut [Option<f32>];
    /// Recompute min/max from the (now gated) values, so the summary ignores the gaps.
    fn refresh_extents(&mut self);
}

impl GatedSeries for SeriesResult {
    fn gated_values(&mut self) -> &mut [Option<f32>] {
        &mut self.values
    }

    fn refresh_extents(&mut self) {
        (self.min_value, self.max_value) = series_extents(&self.values);
    }
}

impl GatedSeries for CalibratedSeriesResult {
    fn gated_values(&mut self) -> &mut [Option<f32>] {
        &mut self.values
    }

    fn refresh_extents(&mut self) {
        (self.min_value, self.max_value) = series_extents(&self.values);
    }
}

/// Apply the window gate to a series, then refresh its extents so the summary's min/max
/// ignore the gated frames.
pub(super) fn apply_gate<T: GatedSeries>(
    result: &mut T,
    mono: &[f32],
    frame: usize,
    hop: usize,
    options: &ToolOptions,
) -> Option<SeriesGate> {
    let gate = gate_values(result.gated_values(), mono, frame, hop, options)?;
    result.refresh_extents();
    Some(gate)
}
