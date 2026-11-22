//! The series / pitch / matrix builders the tools use to shape their results, split out
//! of [`super`] to keep each file inside the source-size budget.

use oxiaudio::dsp::PitchFrame;

use super::{frame_times, seconds};
use crate::audio::analysis::{MatrixResult, PitchResult, SeriesResult, MIN_RELIABLE_VOICED_FRAMES};

pub(crate) fn build_series(
    times: Vec<f32>,
    values: Vec<Option<f32>>,
    hop: usize,
    sample_rate: u32,
) -> SeriesResult {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
    }
    SeriesResult {
        sample_rate,
        hop_size: hop,
        frames: values.len(),
        times,
        // Filled in by `run_window` — the builders only see the sliced region.
        window_start: 0.0,
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        frame_size: None,
        gate: None,
    }
}

/// Wrap one `f32` value per frame (non-finite values become gaps).
pub(crate) fn series_from_vec(values: Vec<f32>, hop: usize, sample_rate: u32) -> SeriesResult {
    let times = frame_times(values.len(), hop, sample_rate);
    let values = values
        .into_iter()
        .map(|value| value.is_finite().then_some(value))
        .collect();
    build_series(times, values, hop, sample_rate)
}

/// A value within this many Hz of the f0 search range's edge counts as pinned to a rail.
const RAIL_TOLERANCE_HZ: f32 = 0.5;

/// Whether `value` sits on the low or high edge of the search range — the detector's way
/// of saying "no period found in range". A track full of these has a median that is just
/// the range boundary, not a pitch.
fn on_rail(value: f32, (min, max): (f32, f32)) -> bool {
    (max > 0.0 && value >= max - RAIL_TOLERANCE_HZ)
        || (min > 0.0 && value <= min + RAIL_TOLERANCE_HZ)
}

/// Wrap a pitch track: unvoiced frames become gaps, times come from the tracker,
/// plus the voiced-frame summary so a nearly-empty track is visible at a glance.
/// `range` is the f0 search window the detector actually used, in Hz.
pub(crate) fn pitch_series(
    frames: Vec<PitchFrame>,
    hop: usize,
    sample_rate: u32,
    range: (f32, f32),
) -> PitchResult {
    let times: Vec<f32> = frames
        .iter()
        .map(|frame| frame.time_seconds as f32)
        .collect();
    let values: Vec<Option<f32>> = frames
        .iter()
        .map(|frame| {
            (frame.is_voiced && frame.frequency_hz.is_finite() && frame.frequency_hz > 0.0)
                .then_some(frame.frequency_hz)
        })
        .collect();
    // Parallel to `values`: the confidence of every voiced frame, gap elsewhere.
    let confidence: Vec<Option<f32>> = values
        .iter()
        .zip(&frames)
        .map(|(value, frame)| value.map(|_| frame.confidence))
        .collect();
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut voiced_frames = 0usize;
    let mut railed_frames = 0usize;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
        voiced_frames += 1;
        if on_rail(*value, range) {
            railed_frames += 1;
        }
    }
    let frames_count = values.len();
    PitchResult {
        sample_rate,
        hop_size: hop,
        frames: frames_count,
        times,
        // Filled in by `run_window` — the builder only sees the sliced region.
        window_start: 0.0,
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        effective_min_f0_hz: range.0,
        effective_max_f0_hz: range.1,
        voiced_frames,
        voiced_fraction: if frames_count == 0 {
            0.0
        } else {
            voiced_frames as f32 / frames_count as f32
        },
        // Enough voiced frames is not enough when the detector pins them to an edge:
        // a median there is the search boundary, not a pitch, so mark it unreliable and
        // let the summary omit it (a purely non-periodic track used to read as reliable).
        f0_reliable: voiced_frames >= MIN_RELIABLE_VOICED_FRAMES
            && railed_frames * 2 < voiced_frames,
        confidence,
        // Only pYIN reports candidates; its dispatcher fills these in.
        candidates: None,
        octave_ambiguous: Vec::new(),
    }
}

/// Flatten a `frames × bands` matrix into a [`MatrixResult`].
pub(crate) fn build_matrix(frames: Vec<Vec<f32>>, hop: usize, sample_rate: u32) -> MatrixResult {
    let n_frames = frames.len();
    let bins = frames.first().map(Vec::len).unwrap_or(0);
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut values = Vec::with_capacity(n_frames * bins);
    for frame in &frames {
        for &value in frame {
            let value = if value.is_finite() { value } else { 0.0 };
            min = min.min(value);
            max = max.max(value);
            values.push(value);
        }
    }
    MatrixResult {
        sample_rate,
        hop_size: hop,
        frames: n_frames,
        bins,
        duration: seconds(n_frames * hop.max(1), sample_rate) as f32,
        times: frame_times(n_frames, hop, sample_rate),
        // Filled in by `run_window` — the builder only sees the sliced region.
        window_start: 0.0,
        bands: (0..bins).map(|i| i as f32).collect(),
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        ..Default::default()
    }
}
