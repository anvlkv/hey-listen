//! The single result shaper (M21).
//!
//! One implementation serves the GUI `run_analysis` command, the headless MCP server,
//! and the batch CLI. A result is shaped by its **semantic family**, not by a generic
//! "long array" rule: matrices and spectrograms keep their dimensions and peak
//! location, event and note lists keep a bounded preview, and numeric series keep
//! min/max/argmin/argmax (with `nulls` when they have gaps). `Shape::Full` returns the
//! raw arrays (optionally decimated); `Shape::Summary` returns no result at all. The
//! compact family shapes live in `compact.rs`, split out for the source-size budget.
//!
//! A summary is always computed from the **full** result ([`super::summarize`]), so it
//! is identical in every mode. See `docs/mcp-cli-ergonomics.md`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{AnalysisResult, MatrixResult, SpectrogramResult};

mod candidates;
mod compact;
mod decimate;
mod grid;

pub(crate) use decimate::{compact_time_axes, indices};

/// Records kept in a bounded preview of an object/event list when the caller does not
/// ask for another length.
pub const DEFAULT_PREVIEW_RECORDS: usize = 5;

/// The most records a caller may ask a compact preview to keep.
pub const MAX_PREVIEW_RECORDS: usize = 50;

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
/// or, for MCP/CLI callers that opt in, as `{ start, hop, length, end }`. A compact
/// result previews [`DEFAULT_PREVIEW_RECORDS`] records per object list; a caller that
/// wants a different length uses [`shape_result_with_preview`].
pub fn shape_result_with(
    result: &AnalysisResult,
    shape: Shape,
    max_points: Option<usize>,
    axis: Axis,
) -> Option<Value> {
    shape_result_with_preview(result, shape, max_points, axis, DEFAULT_PREVIEW_RECORDS)
}

/// [`shape_result_with`], with an explicit compact preview length.
///
/// `preview_records` only shapes a [`Shape::Compact`] result: it bounds how many records
/// each event/note/object list keeps (the list's `length` and `truncated` still describe
/// the whole list).
pub fn shape_result_with_preview(
    result: &AnalysisResult,
    shape: Shape,
    max_points: Option<usize>,
    axis: Axis,
    preview_records: usize,
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
        Shape::Compact => Some(compact::compact_with(result, preview_records)),
    }
}

/// A structurally compact result: scalars are kept, big numeric arrays become stats,
/// and object lists become a bounded preview of [`DEFAULT_PREVIEW_RECORDS`] records.
pub fn compact(result: &AnalysisResult) -> Value {
    compact::compact_with(result, DEFAULT_PREVIEW_RECORDS)
}

/// The extent of a time axis: `{ length, start, hop, end }`.
///
/// `hop` lets an agent turn the `argmin`/`argmax` index of a compact series into a
/// time without fetching the full `times` array. It is only present when the axis is
/// uniform apart from its edge frames (the shared [`decimate::uniform_axis`] rule):
/// a frame-centred envelope's final partial frame can make the tail interval shorter
/// than the hop, and inventing a single hop there would misreport that frame.
fn time_axis(times: &[f32]) -> Value {
    let values: Vec<Value> = times
        .iter()
        .map(|&time| Value::from(f64::from(time)))
        .collect();
    if let Some(axis) = decimate::uniform_axis(&values) {
        return axis;
    }
    let mut map = Map::new();
    map.insert("length".to_string(), Value::from(times.len()));
    if let (Some(first), Some(last)) = (times.first(), times.last()) {
        map.insert("start".to_string(), Value::from(f64::from(*first)));
        map.insert("end".to_string(), Value::from(f64::from(*last)));
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
