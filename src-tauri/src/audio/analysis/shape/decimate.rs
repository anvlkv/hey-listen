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

use super::candidates;
use crate::audio::analysis::AnalysisResult;

/// Decimate a full result to at most `max_points`, respecting the result family.
pub(super) fn decimate_result(result: &AnalysisResult, max_points: usize) -> Value {
    let max = max_points.max(2);
    let mut value = serde_json::to_value(result).unwrap_or(Value::Null);
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    match result {
        // The waveform envelope is a set of equal-length arrays (min/max/bucketRms).
        AnalysisResult::Waveform(_) => aligned(object, max, &["min", "max", "bucketRms"]),
        // Spectrum bins: all four arrays share one frequency axis.
        AnalysisResult::Spectrum(_) => aligned(object, max, &["freqs", "magDb", "minDb", "maxDb"]),
        // Masking curves share the frequency axis.
        AnalysisResult::Masking(_) => aligned(
            object,
            max,
            &[
                "freqs",
                "spectrumDb",
                "thresholdQuietDb",
                "globalMaskDb",
                "smrDb",
            ],
        ),
        // Spectrogram: flat `frames * bins`, no `times` array; scale the hop instead.
        AnalysisResult::Spectrogram(r) => {
            thin_frames(object, max, r.frames, r.bins, "magDb", true);
        }
        // Matrices: flat `frames * bins`, with a `times` array.
        AnalysisResult::MelSpectrogram(r)
        | AnalysisResult::Mfcc(r)
        | AnalysisResult::Chromagram(r)
        | AnalysisResult::SpectralContrast(r)
        | AnalysisResult::CriticalBands(r)
        | AnalysisResult::SpecificLoudness(r) => {
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
        | AnalysisResult::LoudnessMomentary(_)
        | AnalysisResult::Spatial(_) => aligned(object, max, &["times", "values"]),
        // The calibrated perceptual tracks also carry a `frames × bands` contribution
        // grid and, for roughness / fluctuation, a `frames × bands × rates` rate matrix.
        // Both are thinned with them so a compact result keeps every cell aligned, with
        // the band × rate stride preserved.
        AnalysisResult::Sharpness(r)
        | AnalysisResult::Roughness(r)
        | AnalysisResult::FluctuationStrength(r)
        | AnalysisResult::Tonality(r) => {
            aligned(object, max, &["times", "values"]);
            if let Some(contribution) = &r.contribution {
                thin_grid(
                    object,
                    max,
                    "contribution",
                    contribution.frames,
                    contribution.bins,
                );
            }
            if let Some(rates) = &r.rate_contribution {
                thin_grid(
                    object,
                    max,
                    "rateContribution",
                    rates.frames,
                    rates.bands * rates.rates,
                );
            }
        }
        // Loudness carries two gapped tracks over one time axis, plus the RMS/SPL
        // comparator on the same frame grid.
        AnalysisResult::Loudness(_) => aligned(
            object,
            max,
            &[
                "times",
                "loudnessSone",
                "loudnessPhon",
                "frameRmsDb",
                "frameSplDb",
            ],
        ),
        // Pitch tracks are series with gapped values; `confidence` and the octave flags
        // are parallel to them, and the candidate grid thins by whole frames.
        AnalysisResult::PitchPyin(r)
        | AnalysisResult::PitchYin(r)
        | AnalysisResult::PitchAutocorr(r) => {
            aligned(
                object,
                max,
                &["times", "values", "confidence", "octaveAmbiguous"],
            );
            if let Some(grid) = &r.candidates {
                candidates::thin(object, r.times.len(), max, grid);
            }
        }
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
pub(crate) fn compact_time_axes(value: Value) -> Value {
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

/// Thin a nested frame × cell grid (a contribution grid or the band × rate matrix) to
/// the same evenly spaced frame indices as its parent track, so its `times`, axes and
/// `values` stay a valid grid. `stride` is the cells per frame (`bins`, or
/// `bands * rates`), which is preserved.
fn thin_grid(object: &mut Map<String, Value>, max: usize, key: &str, frames: usize, stride: usize) {
    let Some(Value::Object(grid)) = object.get_mut(key) else {
        return;
    };
    if stride == 0 || frames <= max {
        return;
    }
    let keep = indices(frames, max);
    if let Some(Value::Array(times)) = grid.get("times") {
        if times.len() == frames {
            let out: Vec<Value> = keep.iter().map(|&frame| times[frame].clone()).collect();
            grid.insert("times".to_string(), Value::Array(out));
        }
    }
    if let Some(Value::Array(values)) = grid.get("values") {
        if values.len() == frames * stride {
            let mut out = Vec::with_capacity(keep.len() * stride);
            for &frame in &keep {
                let start = frame * stride;
                out.extend_from_slice(&values[start..start + stride]);
            }
            grid.insert("values".to_string(), Value::Array(out));
        }
    }
    grid.insert("frames".to_string(), json!(keep.len()));
    grid.insert("sourceFrames".to_string(), json!(frames));
}

/// `max` evenly spaced indices over `length`, keeping the first and last.
pub(crate) fn indices(length: usize, max: usize) -> Vec<usize> {
    let step = (length - 1) as f64 / (max - 1) as f64;
    (0..max)
        .map(|index| (index as f64 * step).round() as usize)
        .collect()
}

/// `{ start, hop, length, end }` when the times are evenly spaced (see below).
///
/// Overlap-add series (every hop-based tool: `frameRms`, the spectral tracks, momentary
/// loudness) end with one **short edge frame**, so their axis is uniform everywhere but
/// the last interval. Compacting only perfectly uniform axes made `axis: "compact"` a
/// no-op for exactly the tools that repeat the largest time arrays. The axis stays
/// lossless: interior intervals must match `hop` exactly, and an irregular **first** or
/// **last** interval is spelled out as `firstHop` / `lastHop` so every time is
/// reconstructible (`t[i] = t[i−1] + hop` inside, the named hop at an edge).
pub(super) fn uniform_axis(times: &[Value]) -> Option<Value> {
    let values: Option<Vec<f64>> = times.iter().map(Value::as_f64).collect();
    let values = values?;
    if values.len() < 2 {
        return None;
    }
    let hops: Vec<f64> = values.windows(2).map(|pair| pair[1] - pair[0]).collect();
    let mut sorted = hops.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let hop = sorted[sorted.len() / 2];
    if !hop.is_finite() || hop <= 0.0 {
        return None;
    }
    let tolerance = hop * 1e-4 + 1e-9;
    // Interior intervals must be uniform; the first and last are edge frames and may be
    // shorter (overlap-add) — they are carried explicitly below.
    let last = hops.len() - 1;
    for (index, &step) in hops.iter().enumerate() {
        if index == 0 || index == last {
            continue;
        }
        if (step - hop).abs() > tolerance {
            return None;
        }
    }
    let mut axis = json!({
        "start": values[0],
        "hop": hop,
        "length": values.len(),
        "end": values[values.len() - 1],
    });
    // A single interval (two points) has no interior: accept it as its own hop.
    if hops.len() > 1 {
        if let Some(object) = axis.as_object_mut() {
            if (hops[0] - hop).abs() > tolerance {
                object.insert("firstHop".to_string(), json!(hops[0]));
            }
            if (hops[last] - hop).abs() > tolerance {
                object.insert("lastHop".to_string(), json!(hops[last]));
            }
        }
    }
    Some(axis)
}
