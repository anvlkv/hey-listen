//! The shaped forms of a detector's candidate grid: compact stats, and thinning that
//! keeps the grid aligned with its decimated frame axis.
//!
//! The grid is a `frames × bins` cell array, so the two shaping rules that apply to a
//! series would each break it: stats alone would drop the window column axis, and a flat
//! stride would misalign rows. Both helpers here work in whole frames instead.

use serde_json::{json, Map, Value};

use super::decimate::indices;
use crate::audio::analysis::CandidateGrid;

/// The grid as stats: the column axis (one frequency per bin) stays readable while the
/// cell array collapses to its stats, so a compact result never carries the full grid.
pub(super) fn compact(grid: &CandidateGrid) -> Value {
    json!({
        "bins": grid.bins,
        "freqs": grid.freqs,
        "values": super::stats_f32(&grid.values),
    })
}

/// `{ length, ambiguous }` over the per-frame octave-ambiguity flags.
pub(super) fn compact_flags(flags: &[bool]) -> Value {
    json!({
        "length": flags.len(),
        "ambiguous": flags.iter().filter(|flag| **flag).count(),
    })
}

/// Thin the cell array to the frame subset the pitch track keeps, so the grid stays
/// aligned with the decimated `times` / `values`.
///
/// `frames` is the track's frame count; the same [`indices`] subset `aligned` applies to
/// the parallel arrays is used here. A grid that does not hold exactly `frames × bins`
/// cells, or a result the decimation kept whole, is left untouched. `sourceFrames` records
/// the original frame count for provenance, like the matrix decimation does.
pub(super) fn thin(
    object: &mut Map<String, Value>,
    frames: usize,
    max: usize,
    grid: &CandidateGrid,
) {
    if grid.bins == 0 || frames <= max || grid.values.len() != frames * grid.bins {
        return;
    }
    let keep = indices(frames, max);
    let Some(Value::Object(candidates)) = object.get_mut("candidates") else {
        return;
    };
    let mut cells = Vec::with_capacity(keep.len() * grid.bins);
    for &frame in &keep {
        let start = frame * grid.bins;
        cells.extend_from_slice(&grid.values[start..start + grid.bins]);
    }
    candidates.insert("values".to_string(), json!(cells));
    candidates.insert("sourceFrames".to_string(), json!(frames));
}
