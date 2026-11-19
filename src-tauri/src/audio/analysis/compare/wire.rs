//! The wire shape of a [`Comparison`]: both shaped sides and the delta, split out of
//! `compare/mod.rs` for the source-size budget.
//!
//! Each side is shaped exactly like a `run_analysis` result, so the same `Shape`,
//! `maxPoints`, axis spelling and compact preview length apply, and the delta follows
//! `includeData` with its raw arrays thinned and stripped alongside (MCP/CLI parity).

use serde_json::Value;

use crate::audio::analysis::{self, Axis, Shape, DEFAULT_PREVIEW_RECORDS};

use super::{Comparison, ComparisonDiff, ComparisonSide};

impl Comparison {
    /// The wire shape: both sides (shaped like `run_analysis`), the comparability, and
    /// the delta. `shape` controls how much of each **result** is returned; the delta's
    /// raw arrays follow `includeData` (i.e. `Shape::Full`), are thinned by `max_points`
    /// and share `axis` with the side results. Each compact object list keeps
    /// [`DEFAULT_PREVIEW_RECORDS`] records; [`Self::to_value_with_preview`] takes an
    /// explicit length.
    pub fn to_value(&self, shape: Shape, max_points: Option<usize>, axis: Axis) -> Value {
        self.to_value_with_preview(shape, max_points, axis, DEFAULT_PREVIEW_RECORDS)
    }

    /// [`Self::to_value`], with an explicit compact preview length per side result.
    pub fn to_value_with_preview(
        &self,
        shape: Shape,
        max_points: Option<usize>,
        axis: Axis,
        preview_records: usize,
    ) -> Value {
        let a = self.side_value(&self.a, shape, max_points, axis, preview_records);
        let b = self.side_value(&self.b, shape, max_points, axis, preview_records);
        let mut value = serde_json::json!({
            "tool": self.tool,
            "a": a,
            "b": b,
            "comparability": self.comparability,
        });
        if let Some(diff) = &self.diff {
            value["diff"] = delta_value(diff, shape, max_points, axis);
        }
        value
    }

    fn side_value(
        &self,
        side: &ComparisonSide,
        shape: Shape,
        max_points: Option<usize>,
        axis: Axis,
        preview_records: usize,
    ) -> Value {
        let mut value = serde_json::json!({
            "project": side.project,
            "source": side.source,
            "window": { "start": side.setup.start, "end": side.setup.end },
            "params": side.setup.params,
            "options": side.options,
            "summary": side.summary,
        });
        if let Some(result) = analysis::shape_result_with_preview(
            &side.result,
            shape,
            max_points,
            axis,
            preview_records,
        ) {
            value["result"] = result;
        }
        value
    }
}

/// Shape the delta for the wire: full (optionally thinned and compacted), or stats +
/// summary with the raw arrays cleared.
fn delta_value(
    diff: &ComparisonDiff,
    shape: Shape,
    max_points: Option<usize>,
    axis: Axis,
) -> Value {
    if shape == Shape::Full {
        let mut full = diff.clone();
        if let Some(points) = max_points {
            full.thin(points);
        }
        let value = serde_json::to_value(&full).unwrap_or(Value::Null);
        match axis {
            Axis::Array => value,
            Axis::Compact => super::super::shape::compact_time_axes(value),
        }
    } else {
        let mut value = serde_json::to_value(diff).unwrap_or(Value::Null);
        strip_delta_arrays(&mut value);
        value
    }
}

/// Drop the delta's raw numeric arrays (the stats remain), for the compact and summary
/// modes. Event/note lists are never thinned, so they stay.
fn strip_delta_arrays(value: &mut Value) {
    const ARRAYS: [&str; 6] = ["times", "values", "a", "b", "freqs", "rateHz"];
    let Some(object) = value.as_object_mut() else {
        return;
    };

    for key in ARRAYS {
        if object.contains_key(key) {
            object.insert(key.to_string(), Value::Array(Vec::new()));
        }
    }
    // A nested envelope/line delta carries its own stats; clear only its arrays.
    for key in ["envelope", "am", "fm"] {
        if let Some(nested) = object.get_mut(key) {
            strip_delta_arrays(nested);
        }
    }
}
