//! The project-state snapshot that undo/redo records.
//!
//! This is the **single** statement of what is undoable: the project file's sections
//! minus `DATA` (the PCM) and `RESULTS` (a cache). The frontend pushes every field except
//! `compare`, which the core fills from its in-memory saved comparisons ([`crate::state::WindowState`]) because the frontend never
//! holds a full [`SavedComparison`]. `canonical_json` lives here too, so the key-order
//! normalisation the dedupe needs has one home (mirrors
//! `src/state/project/dirty.ts`'s `canonical()`).

use serde::{Deserialize, Serialize};

use crate::audio::analysis::compare::{SavedComparison, SavedComparisonInfo};
use crate::project::{AnalysisSetup, Annotation, SourceDescriptor};

/// The project content undo/redo records, in the shape the project file stores it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectSnapshot {
    /// The project's display name (the `META`-adjacent identity).
    pub name: String,
    /// `SOURCE`: the descriptor, not the PCM (ADR-21).
    pub source: Option<SourceDescriptor>,
    /// `SETUP`: shared params, per-tool options, open tools, window, view, filter bypass.
    pub setup: AnalysisSetup,
    /// `LAYOUT`: dockview, graph editor state, popouts and the compiled filter spec.
    /// Opaque JSON here — the frontend owns its shape.
    pub layout: serde_json::Value,
    /// `ANNOTATIONS`.
    pub annotations: Vec<Annotation>,
    /// `COMPARE`: the saved comparison snapshots (ADR-24/27), filled by the core.
    ///
    /// The TS projection is the compact [`SavedComparisonInfo`]: the frontend neither
    /// reads nor builds the full snapshot (it pushes an empty list), and the stored
    /// result payload has no TypeScript mirror.
    #[ts(as = "Vec<SavedComparisonInfo>")]
    pub compare: Vec<SavedComparison>,
}

/// Copy a JSON value with every object's keys sorted, so equal state produces an equal
/// value regardless of the order it was serialized in.
///
/// State crosses to the core and back as JSON, and a round-trip need not preserve the
/// insertion order of records such as `toolOptions`, so an order-only difference must
/// not read as a change.
pub fn canonical_json(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(canonical_json).collect())
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_unstable();
            let mut sorted = serde_json::Map::new();
            for key in keys {
                sorted.insert(key.clone(), canonical_json(&map[key]));
            }
            serde_json::Value::Object(sorted)
        }
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_json_sorts_keys_at_every_level() {
        let value = serde_json::json!({ "b": { "y": 1, "x": 2 }, "a": [{ "d": 4, "c": 3 }] });
        let sorted = canonical_json(&value);
        assert_eq!(
            serde_json::to_string(&sorted).unwrap(),
            r#"{"a":[{"c":3,"d":4}],"b":{"x":2,"y":1}}"#
        );
    }

    #[test]
    fn the_default_snapshot_is_empty_project_content() {
        let snapshot = ProjectSnapshot::default();
        assert!(snapshot.source.is_none());
        assert!(snapshot.annotations.is_empty());
        assert!(snapshot.compare.is_empty());
        assert_eq!(canonical_json(&snapshot.layout), serde_json::Value::Null);
    }
}
