//! The single result shaper (M21).
//!
//! One implementation serves the GUI `run_analysis` command, the headless MCP server,
//! and the batch CLI. A result is shaped by its **semantic family**, not by a generic
//! "long array" rule: matrices and spectrograms keep their dimensions and peak
//! location, event and note lists keep a bounded preview, and numeric series keep
//! min/max/argmin/argmax (with `nulls` when they have gaps). `Shape::Full` returns the
//! raw arrays (optionally decimated); `Shape::Summary` returns no result at all.
//!
//! A summary is always computed from the **full** result ([`super::summarize`]), so it
//! is identical in every mode. See `docs/mcp-cli-ergonomics.md`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{
    AnalysisResult, MatrixResult, NoteMetric, NoteMetricsResult, PitchResult, RhythmResult,
    SeriesResult, SpectrogramResult, SpectrumResult, WaveformResult,
};

mod decimate;

/// How much of a result to return.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Shape {
    /// The summary alone (no `result`).
    Summary,
    /// The summary plus a structurally compacted result.
    Compact,
    /// The summary plus the raw result arrays.
    #[default]
    Full,
}

/// Records kept in a bounded preview of an object/event list.
const PREVIEW_RECORDS: usize = 5;

/// How a `Shape::Full` result spells its time axes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Axis {
    /// Every frame time is an array entry (the GUI charts read this).
    #[default]
    Array,
    /// A uniform time axis becomes `{ start, hop, length, end }`; values are unchanged.
    Compact,
}

/// Shape a result for the wire, or `None` when only the summary is wanted.
///
/// `axis` picks how a `full` result spells its time axes: as arrays (the GUI charts)
/// or, for MCP/CLI callers that opt in, as `{ start, hop, length, end }`.
pub fn shape_result_with(
    result: &AnalysisResult,
    shape: Shape,
    max_points: Option<usize>,
    axis: Axis,
) -> Option<Value> {
    match shape {
        Shape::Summary => None,
        Shape::Full => {
            let value = match max_points {
                Some(points) => decimate::decimate_result(result, points),
                None => serde_json::to_value(result).ok()?,
            };
            Some(match axis {
                Axis::Array => value,
                Axis::Compact => decimate::compact_time_axes(value),
            })
        }
        Shape::Compact => Some(compact(result)),
    }
}

/// A structurally compact result: scalars are kept, big numeric arrays become stats,
/// and object lists become a bounded preview.
pub fn compact(result: &AnalysisResult) -> Value {
    let mut value = serde_json::to_value(result).unwrap_or(Value::Null);
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    match result {
        AnalysisResult::Waveform(r) => compact_waveform(object, r),
        AnalysisResult::Spectrum(r) => compact_spectrum(object, r),
        AnalysisResult::Spectrogram(r) => compact_spectrogram(object, r),
        AnalysisResult::MelSpectrogram(r)
        | AnalysisResult::Mfcc(r)
        | AnalysisResult::Chromagram(r)
        | AnalysisResult::SpectralContrast(r) => compact_matrix(object, r),
        AnalysisResult::PitchPyin(r)
        | AnalysisResult::PitchYin(r)
        | AnalysisResult::PitchAutocorr(r) => compact_pitch(object, r),
        AnalysisResult::Tempo(r) | AnalysisResult::Onsets(r) | AnalysisResult::Downbeats(r) => {
            compact_rhythm(object, r)
        }
        AnalysisResult::NoteMetrics(r) => compact_notes(object, r),
        AnalysisResult::Modulation(r) => {
            insert(object, "modFreqs", stats_f32(&r.mod_freqs));
            insert(object, "amDb", stats_f32(&r.am_db));
            insert(object, "fmDb", stats_f32(&r.fm_db));
        }
        other => {
            // Every scalar-per-frame tool shares one compact shape; the scalar
            // readouts (levels, integrated loudness, LRA) carry no series and pass
            // through unchanged.
            if let Some(r) = other.series() {
                compact_gapped_series(object, r);
            }
        }
    }
    value
}

fn compact_waveform(object: &mut Map<String, Value>, r: &WaveformResult) {
    insert(object, "min", stats_f32(&r.min));
    insert(object, "max", stats_f32(&r.max));
}

fn compact_spectrum(object: &mut Map<String, Value>, r: &SpectrumResult) {
    insert(object, "freqs", stats_f32(&r.freqs));
    insert(object, "magDb", stats_f32(&r.mag_db));
    insert(object, "minDb", stats_f32(&r.min_db));
    insert(object, "maxDb", stats_f32(&r.max_db));
}

fn compact_spectrogram(object: &mut Map<String, Value>, r: &SpectrogramResult) {
    insert(object, "freqs", stats_f32(&r.freqs));
    insert(object, "magDb", stats_f32(&r.mag_db));
    if let Some((_, bin, time, level)) = spectrogram_peak(r) {
        insert(object, "peakTime", Value::from(time));
        if let Some(hz) = r.freqs.get(bin) {
            insert(object, "peakHz", Value::from(f64::from(*hz)));
        }
        insert(object, "peakDb", Value::from(f64::from(level)));
    }
}

fn compact_matrix(object: &mut Map<String, Value>, r: &MatrixResult) {
    insert(object, "times", time_axis(&r.times));
    if let Some((frame, band, value)) = matrix_peak(r) {
        insert(object, "peakFrame", Value::from(frame));
        insert(object, "peakBand", Value::from(band));
        insert(object, "peakValue", Value::from(f64::from(value)));
        if let Some(time) = r.times.get(frame) {
            insert(object, "peakTime", Value::from(f64::from(*time)));
        }
    }
    insert(object, "values", stats_f32(&r.values));
}

fn compact_gapped_series(object: &mut Map<String, Value>, r: &SeriesResult) {
    insert(object, "times", time_axis(&r.times));
    insert(object, "values", stats_gaps(&r.values));
}

fn compact_pitch(object: &mut Map<String, Value>, r: &PitchResult) {
    insert(object, "times", time_axis(&r.times));
    insert(object, "values", stats_gaps(&r.values));
}

fn compact_rhythm(object: &mut Map<String, Value>, r: &RhythmResult) {
    insert(object, "times", time_axis(&r.times));
    insert(object, "onsetStrength", stats_f32(&r.onset_strength));
    insert(object, "onsetTimes", preview(&r.onset_times));
    insert(object, "beatTimes", preview(&r.beat_times));
    insert(object, "downbeatTimes", preview(&r.downbeat_times));
}

fn compact_notes(object: &mut Map<String, Value>, r: &NoteMetricsResult) {
    insert(object, "notes", preview(&r.notes));
    insert(object, "gaps", preview(&r.gaps));
    // The event spans are the answer to "where are the events?" — keep them all, even
    // when the heavy per-note records are previewed. Without this an agent must switch
    // to a full result (and must not pass `maxPoints`, which would drop notes).
    let bounds: Vec<Value> = r.notes.iter().map(compact_note_bounds).collect();
    insert(object, "bounds", Value::Array(bounds));
}

fn compact_note_bounds(note: &NoteMetric) -> Value {
    serde_json::json!({
        "startSecs": note.start_secs,
        "endSecs": note.end_secs,
        "gapAfterSecs": note.gap_after_secs,
    })
}

// --- compact shapes -------------------------------------------------------

/// A bounded preview of an object/event list: its length, the first few records, and
/// whether anything was omitted.
fn preview<T: Serialize>(items: &[T]) -> Value {
    let shown = items.len().min(PREVIEW_RECORDS);
    let records = serde_json::to_value(&items[..shown]).unwrap_or(Value::Null);
    serde_json::json!({
        "length": items.len(),
        "preview": records,
        "truncated": items.len() > shown,
    })
}

/// The extent of a time axis: `{ length, start, hop, end }`.
///
/// `hop` lets an agent turn the `argmin`/`argmax` index of a compact series into a
/// time without fetching the full `times` array.
fn time_axis(times: &[f32]) -> Value {
    let mut map = Map::new();
    map.insert("length".to_string(), Value::from(times.len()));
    if let (Some(first), Some(last)) = (times.first(), times.last()) {
        map.insert("start".to_string(), Value::from(f64::from(*first)));
        map.insert("end".to_string(), Value::from(f64::from(*last)));
        if times.len() > 1 {
            let hop = (f64::from(*last) - f64::from(*first)) / (times.len() - 1) as f64;
            map.insert("hop".to_string(), Value::from(hop));
        }
    }
    Value::Object(map)
}

/// `{ length, [nulls], min, max, argmin, argmax }` over a plain numeric array.
fn stats_f32(values: &[f32]) -> Value {
    Value::Object(accumulate(
        values.iter().map(|value| Some(f64::from(*value))),
        values.len(),
    ))
}

/// The same stats over a gapped array, with `nulls` when it has gaps.
fn stats_gaps(values: &[Option<f32>]) -> Value {
    Value::Object(accumulate(
        values.iter().map(|value| value.map(f64::from)),
        values.len(),
    ))
}

fn accumulate(values: impl Iterator<Item = Option<f64>>, length: usize) -> Map<String, Value> {
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let (mut argmin, mut argmax) = (0usize, 0usize);
    let (mut nulls, mut present) = (0usize, 0usize);
    for (index, value) in values.enumerate() {
        let Some(value) = value else {
            nulls += 1;
            continue;
        };
        if !value.is_finite() {
            nulls += 1;
            continue;
        }
        present += 1;
        if value < min {
            min = value;
            argmin = index;
        }
        if value > max {
            max = value;
            argmax = index;
        }
    }
    let mut map = Map::new();
    map.insert("length".to_string(), Value::from(length));
    if nulls > 0 {
        map.insert("nulls".to_string(), Value::from(nulls));
    }
    if present > 0 {
        map.insert("min".to_string(), Value::from(min));
        map.insert("max".to_string(), Value::from(max));
        map.insert("argmin".to_string(), Value::from(argmin));
        map.insert("argmax".to_string(), Value::from(argmax));
    }
    map
}

fn insert(object: &mut Map<String, Value>, key: &str, value: Value) {
    object.insert(key.to_string(), value);
}

/// The first index of the maximum value (the peak a result names).
pub(super) fn flat_peak(values: &[f32]) -> Option<(usize, f32)> {
    let mut best: Option<(usize, f32)> = None;
    for (index, value) in values.iter().enumerate() {
        if value.is_finite() && best.is_none_or(|(_, current)| *value > current) {
            best = Some((index, *value));
        }
    }
    best
}

/// The strongest cell of a frame × band matrix: `(frame, band, value)`.
pub(super) fn matrix_peak(r: &MatrixResult) -> Option<(usize, usize, f32)> {
    let (index, value) = flat_peak(&r.values)?;
    let bins = r.bins.max(1);
    Some((index / bins, index % bins, value))
}

/// The strongest cell of a spectrogram: `(frame, bin, source-second time, level)`.
pub(super) fn spectrogram_peak(r: &SpectrogramResult) -> Option<(usize, usize, f64, f32)> {
    let (index, level) = flat_peak(&r.mag_db)?;
    let bins = r.bins.max(1);
    let frame = index / bins;
    let bin = index % bins;
    let time = r.window_start + frame as f64 * r.hop_size as f64 / f64::from(r.sample_rate.max(1));
    Some((frame, bin, time, level))
}
