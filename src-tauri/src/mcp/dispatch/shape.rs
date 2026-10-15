//! Result shaping for the headless dispatch table.
//!
//! A tool's full result can be huge, so — unless the agent asked for `includeData` —
//! it is shrunk for the wire here, exactly as the GUI's `run_analysis` does. Keep
//! this in step with the frontend's `compact` / `decimate` in `src/state/mcp/shaping.ts`.

use serde_json::{json, Value};

/// Above this length a numeric / gapped array is summarized rather than listed.
const COMPACT_ARRAY_MIN: usize = 8;
/// Above this length any array (numeric or not) is reduced to its length.
const COMPACT_LENGTH_MIN: usize = 16;

/// Shrink a result for the agent — the same shape the GUI's `run_analysis` uses.
///
/// A long numeric array becomes `{ length, min, max, argmin, argmax }`; a long array
/// with gaps (`null`s, e.g. a pitch track's unvoiced frames) becomes
/// `{ length, nulls, min, max, argmin, argmax }` over the present numbers (so a
/// nearly-empty track is visible at a glance, and the peak can be located without
/// `includeData`); any other long array becomes `{ length }`. Objects recurse.
/// `includeData: true` returns the raw result instead. Keep this in step with the
/// frontend's `compact` in `src/state/mcp/shaping.ts`.
pub(super) fn compact(value: Value) -> Value {
    match value {
        Value::Array(items) if items.len() > COMPACT_ARRAY_MIN => compact_array(items),
        Value::Array(items) => Value::Array(items.into_iter().map(compact).collect()),
        Value::Object(map) => {
            Value::Object(map.into_iter().map(|(key, v)| (key, compact(v))).collect())
        }
        other => other,
    }
}

/// Summarize an array longer than [`COMPACT_ARRAY_MIN`]: numbers and `null`s become a
/// stats object (with `nulls` when there are gaps); anything else long enough becomes
/// just its length.
fn compact_array(items: Vec<Value>) -> Value {
    let length = items.len();
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut argmin = 0usize;
    let mut argmax = 0usize;
    let mut nulls = 0usize;
    let mut present = 0usize;
    for (index, item) in items.iter().enumerate() {
        let Some(number) = item.as_f64() else {
            if item.is_null() {
                nulls += 1;
                continue;
            }
            // Not a numeric / gap array: fall back to the length (or recurse, if short).
            return if length > COMPACT_LENGTH_MIN {
                json!({ "length": length })
            } else {
                Value::Array(items.into_iter().map(compact).collect())
            };
        };
        present += 1;
        if number < min {
            min = number;
            argmin = index;
        }
        if number > max {
            max = number;
            argmax = index;
        }
    }
    // All gaps: no numbers to summarize.
    if present == 0 {
        return json!({ "length": length, "nulls": nulls });
    }
    if nulls == 0 {
        json!({
            "length": length,
            "min": min,
            "max": max,
            "argmin": argmin,
            "argmax": argmax,
        })
    } else {
        json!({
            "length": length,
            "nulls": nulls,
            "min": min,
            "max": max,
            "argmin": argmin,
            "argmax": argmax,
        })
    }
}

/// Decimate every array longer than `max_points` to at most `max_points` entries by
/// striding (keeping the first and last), so a bounded `includeData` can return a
/// representative series instead of every frame. Objects recurse. Keep this in step
/// with the frontend's `decimate` in `src/state/mcp/shaping.ts`.
pub(super) fn decimate(value: Value, max_points: usize) -> Value {
    let max_points = max_points.max(2);
    match value {
        Value::Array(items) if items.len() > max_points => {
            let last = items.len() - 1;
            let step = last as f64 / (max_points - 1) as f64;
            let mut out = Vec::with_capacity(max_points);
            for index in 0..max_points {
                let source = (index as f64 * step).round() as usize;
                out.push(decimate(items[source].clone(), max_points));
            }
            Value::Array(out)
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| decimate(item, max_points))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, decimate(value, max_points)))
                .collect(),
        ),
        other => other,
    }
}
