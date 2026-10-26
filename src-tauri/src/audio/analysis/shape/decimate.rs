//! Family-aware decimation for `Shape::Full` and the compact time-axis option.
//!
//! `maxPoints` is requested by agents that want a bounded *series* (a pitch track, a
//! spectral curve), not by callers that want every event. The generic "stride every
//! array" rule silently broke two families:
//!
//! - a matrix is `frames * bins` values, so striding the flat array destroys the
//!   frame × band structure (`times` and `values` no longer align);
//! - a note/onset list is a list of **records**, so striding it drops events.
//!
//! This module decimates by family: time axes move together with their series, a
//! matrix/spectrogram is thinned **by whole frames** (and its `hopSize` is scaled, so
//! the result is still a valid grid), and event lists are left untouched.

use serde_json::{json, Map, Value};

use crate::audio::analysis::AnalysisResult;

/// Decimate a full result to at most `max_points`, respecting the result family.
pub(super) fn decimate_result(result: &AnalysisResult, max_points: usize) -> Value {
    let max = max_points.max(2);
    let mut value = serde_json::to_value(result).unwrap_or(Value::Null);
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    match result {
        // The waveform envelope is a pair of equal-length arrays (min/max).
        AnalysisResult::Waveform(_) => aligned(object, max, &["min", "max"]),
        // Spectrum bins: all four arrays share one frequency axis.
        AnalysisResult::Spectrum(_) => aligned(object, max, &["freqs", "magDb", "minDb", "maxDb"]),
        // Spectrogram: flat `frames * bins`, no `times` array; scale the hop instead.
        AnalysisResult::Spectrogram(r) => {
            thin_frames(object, max, r.frames, r.bins, "magDb", true);
        }
        // Matrices: flat `frames * bins`, with a `times` array.
        AnalysisResult::MelSpectrogram(r)
        | AnalysisResult::Mfcc(r)
        | AnalysisResult::Chromagram(r)
        | AnalysisResult::SpectralContrast(r) => {
            thin_frames(object, max, r.frames, r.bins, "values", false);
        }
        // Scalar-per-frame series.
        AnalysisResult::SpectralCentroid(_)
        | AnalysisResult::SpectralFlux(_)
        | AnalysisResult::SpectralRolloff(_)
        | AnalysisResult::SpectralFlatness(_)
        | AnalysisResult::SpectralBandwidth(_)
        | AnalysisResult::SpectralEntropy(_)
        | AnalysisResult::SpectralCrest(_)
        | AnalysisResult::HarmonicRatio(_)
        | AnalysisResult::ZeroCrossingRate(_)
        | AnalysisResult::FrameRms(_)
        | AnalysisResult::LoudnessMomentary(_) => aligned(object, max, &["times", "values"]),
        // Pitch tracks are series with gapped values.
        AnalysisResult::PitchPyin(_)
        | AnalysisResult::PitchYin(_)
        | AnalysisResult::PitchAutocorr(_) => aligned(object, max, &["times", "values"]),
        // Rhythm: thin the envelope, but keep the detected event lists whole.
        AnalysisResult::Tempo(_) | AnalysisResult::Onsets(_) | AnalysisResult::Downbeats(_) => {
            aligned(object, max, &["times", "onsetStrength"]);
        }
        // Modulation spectra share `modFreqs`; both spectra thin together.
        AnalysisResult::Modulation(_) => aligned(object, max, &["modFreqs", "amDb", "fmDb"]),
        // Event/note lists and scalar readouts have nothing safe to thin.
        AnalysisResult::NoteMetrics(_)
        | AnalysisResult::Levels(_)
        | AnalysisResult::LoudnessIntegrated(_)
        | AnalysisResult::LoudnessRange(_) => {}
    }
    value
}

/// Replace uniform `times` arrays with `{ start, hop, length }`.
///
/// This is the opt-in `axis: "compact"` full mode: the consumer keeps every value but
/// does not pay for a repeated, evenly spaced time array. A non-uniform axis is left
/// as-is, so the result stays self-describing.
pub(super) fn compact_time_axes(value: Value) -> Value {
    match value {
        Value::Object(mut object) => {
            let axis = object
                .get("times")
                .and_then(Value::as_array)
                .and_then(|times| uniform_axis(times));
            if let Some(axis) = axis {
                object.insert("times".to_string(), axis);
            }
            Value::Object(
                object
                    .into_iter()
                    .map(|(key, value)| (key, compact_time_axes(value)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.into_iter().map(compact_time_axes).collect()),
        other => other,
    }
}

/// Thin a set of equal-length arrays by the same indices, keeping the first and last.
fn aligned(object: &mut Map<String, Value>, max: usize, keys: &[&str]) {
    let Some(length) = keys
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_array).map(Vec::len))
    else {
        return;
    };
    if length <= max {
        return;
    }
    let indices = indices(length, max);
    for key in keys {
        let Some(Value::Array(items)) = object.get(*key) else {
            continue;
        };
        if items.len() != length {
            continue;
        }
        let out: Vec<Value> = indices.iter().map(|&index| items[index].clone()).collect();
        object.insert((*key).to_string(), Value::Array(out));
    }
}

/// Thin a frame × band matrix by whole frames, so `values` still has `frames * bins`
/// entries. `times` is copied for the kept frames; a spectrogram (no `times`) has its
/// `hopSize` scaled instead. `frames` becomes the kept count; `sourceFrames` keeps the
/// original for provenance.
fn thin_frames(
    object: &mut Map<String, Value>,
    max: usize,
    frames: usize,
    bins: usize,
    key: &str,
    scale_hop: bool,
) {
    if bins == 0 || frames <= max {
        return;
    }
    let stride = frames.div_ceil(max);
    let keep: Vec<usize> = (0..frames).step_by(stride).collect();
    if let Some(Value::Array(values)) = object.get(key) {
        if values.len() == frames * bins {
            let mut out = Vec::with_capacity(keep.len() * bins);
            for &frame in &keep {
                let start = frame * bins;
                out.extend_from_slice(&values[start..start + bins]);
            }
            object.insert(key.to_string(), Value::Array(out));
        }
    }
    if let Some(Value::Array(times)) = object.get("times") {
        if times.len() == frames {
            let out: Vec<Value> = keep
                .iter()
                .filter_map(|&frame| times.get(frame).cloned())
                .collect();
            object.insert("times".to_string(), Value::Array(out));
        }
    }
    object.insert("frames".to_string(), json!(keep.len()));
    object.insert("sourceFrames".to_string(), json!(frames));
    if scale_hop {
        if let Some(hop) = object.get("hopSize").and_then(Value::as_u64) {
            object.insert("hopSize".to_string(), json!(hop * stride as u64));
            object.insert("sourceHopSize".to_string(), json!(hop));
        }
    }
}

/// `max` evenly spaced indices over `length`, keeping the first and last.
fn indices(length: usize, max: usize) -> Vec<usize> {
    let step = (length - 1) as f64 / (max - 1) as f64;
    (0..max)
        .map(|index| (index as f64 * step).round() as usize)
        .collect()
}

/// `{ start, hop, length, end }` when the times are evenly spaced.
fn uniform_axis(times: &[Value]) -> Option<Value> {
    let values: Option<Vec<f64>> = times.iter().map(Value::as_f64).collect();
    let values = values?;
    if values.len() < 2 {
        return None;
    }
    let hop = (values[values.len() - 1] - values[0]) / (values.len() - 1) as f64;
    if !hop.is_finite() || hop <= 0.0 {
        return None;
    }
    let tolerance = hop * 1e-4 + 1e-9;
    let uniform = values
        .windows(2)
        .all(|pair| (pair[1] - pair[0] - hop).abs() <= tolerance);
    if !uniform {
        return None;
    }
    Some(json!({
        "start": values[0],
        "hop": hop,
        "length": values.len(),
        "end": values[values.len() - 1],
    }))
}
