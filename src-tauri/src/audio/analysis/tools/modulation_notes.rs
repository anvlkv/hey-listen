//! The per-note modulation breakdown (D-18): segment the window with the same gate
//! `noteMetrics` uses, then measure AM/FM modulation on each detected note with the
//! shared `modulation_core`. No second envelope is computed — the window's
//! frame-RMS levels are the segmentation input — and no analysis code is copied.

use super::super::{AnalysisError, Cancel, ModulationNote, ToolOptions, DB_FLOOR, MAX_NOTES};
use super::modulation_core::{measure, MIN_ANALYSIS_SAMPLES};
use super::notes::{gate_from, segment_notes, Segment};

/// One `ModulationNote` per detected note, bounded by [`MAX_NOTES`].
///
/// `levels`, `frame`, and `hop` are the window's frame-RMS envelope (the same one the
/// window measurement uses), so a note is the same span `noteMetrics` would report.
pub(super) fn per_note(
    mono: &[f32],
    sample_rate: u32,
    options: &ToolOptions,
    levels: &[f32],
    frame: usize,
    hop: usize,
    cancel: &Cancel,
) -> Result<Vec<ModulationNote>, AnalysisError> {
    let rate = sample_rate.max(1);
    let duration = mono.len() as f32 / rate as f32;
    let peak_db = levels.iter().copied().fold(DB_FLOOR, f32::max);
    let gate = gate_from(options, peak_db);
    let mut spans = segment_notes(levels, frame, hop, rate, duration, &gate);
    spans.truncate(MAX_NOTES);
    let measured = spans
        .iter()
        .map(|span| note_measurement(mono, rate, options, *span, cancel))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(measured.into_iter().flatten().collect())
}

/// Measure one note segment, or `None` when the span is too short for the core to say
/// anything meaningful about it.
fn note_measurement(
    mono: &[f32],
    sample_rate: u32,
    options: &ToolOptions,
    span: Segment,
    cancel: &Cancel,
) -> Result<Option<ModulationNote>, AnalysisError> {
    let rate = sample_rate as f32;
    let first = ((span.start.max(0.0) * rate).floor() as usize).min(mono.len());
    let last = ((span.end.max(0.0) * rate).ceil() as usize)
        .min(mono.len())
        .max(first);
    let slice = &mono[first..last];
    if slice.len() < MIN_ANALYSIS_SAMPLES {
        return Ok(None);
    }
    let measured = measure(slice, sample_rate, options, cancel)?;
    Ok(Some(ModulationNote {
        start_secs: span.start,
        end_secs: span.end,
        am_depth: measured.am_depth,
        am_peak_to_trough_db: measured.am_peak_to_trough_db,
        am_peaks: measured.am_peaks,
        fm_rate_hz: measured.fm_rate_hz,
        fm_peak_to_peak_cents: measured.fm_peak_to_peak_cents,
        fm_std_cents: measured.fm_std_cents,
        fm_reliable: measured.fm_reliable,
        voiced_fraction: measured.voiced_fraction,
    }))
}
