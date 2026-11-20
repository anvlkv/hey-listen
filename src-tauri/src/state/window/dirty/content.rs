//! The JSON half of the dirty signature: the project content a signature compares (with
//! the parts that are not project identity stripped), and the pushed `ui-state` inputs read
//! out of it. `state/window/dirty.rs` is the state machine that uses them.

use serde_json::{Map, Value};

use crate::state::snapshot::canonical_json;

/// The dirty content of a snapshot, from its JSON: canonical (sorted) and with the two
/// things that are not project identity stripped.
///
/// **Dockview's pixel sizes** track the window, not the project: restoring a layout in a
/// differently sized window changes them, which made a freshly loaded project look dirty.
/// The layout's grid also records the viewport's `width`/`height`, stripped the same way.
/// Structure (panels, views, split topology, active group) is kept.
///
/// **The saved comparisons** (`COMPARE`) carry whole result payloads — a spectrogram is
/// megabytes — and their live views are the signature's separate `compare` input (as
/// `dirty.ts` tracked them), so the payloads never enter a signature.
pub(super) fn stripped(value: &Value) -> Value {
    let mut content = value.clone();
    if let Value::Object(map) = &mut content {
        map.remove("compare");
    }
    canonical_json(&without_viewport_sizes(&content))
}

/// Copy a JSON value with every object key named `size` — and every layout grid's
/// `width`/`height` — dropped.
fn without_viewport_sizes(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(without_viewport_sizes).collect()),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, entry) in map {
                if key == "size" {
                    continue;
                }
                let entry = without_viewport_sizes(entry);
                let entry = if key == "grid" {
                    without_grid_extent(entry)
                } else {
                    entry
                };
                out.insert(key.clone(), entry);
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Drop a grid object's `width`/`height` (the viewport's dimensions), keeping its topology.
fn without_grid_extent(value: Value) -> Value {
    let Value::Object(mut map) = value else {
        return value;
    };
    map.remove("width");
    map.remove("height");
    Value::Object(map)
}

/// Whether both graph editors are still in their seeded shape, from the frontend's
/// `graphPristine` push (`{ "filter": bool, "synth": bool }`).
///
/// A window that has not pushed the key yet has not touched a graph, so it counts as
/// pristine; a value that is present but malformed does not (the safe answer for a
/// discard prompt is to ask).
pub(super) fn graphs_pristine(value: Option<&Value>) -> bool {
    value.is_none_or(|value| {
        ["filter", "synth"]
            .iter()
            .all(|graph| value.get(*graph).and_then(Value::as_bool).unwrap_or(false))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewport_sizes_are_stripped_at_every_depth() {
        let layout = serde_json::json!({
            "grid": { "root": { "size": 900, "data": [] }, "width": 1440, "height": 900 },
            "panels": { "a": { "size": 400, "title": "Graph" } },
            "activeGroup": "a",
        });
        assert_eq!(
            without_viewport_sizes(&layout),
            serde_json::json!({
                "grid": { "root": { "data": [] } },
                "panels": { "a": { "title": "Graph" } },
                "activeGroup": "a",
            })
        );
    }

    /// The regression this guards: restoring a layout in a differently sized window changed
    /// only the pixel sizes, and a saved comparison's result payload moved a fresh one in.
    #[test]
    fn a_viewport_resize_and_a_saved_payload_are_not_content() {
        let content = serde_json::json!({
            "name": "song",
            "compare": [],
            "layout": {
                "dockview": { "grid": { "width": 1440, "height": 900, "root": { "size": 500 } } },
                "graphs": { "filter": { "nodes": [] } },
            },
        });
        let resized = serde_json::json!({
            "name": "song",
            "compare": [{ "result": [1.0, 2.0, 3.0] }],
            "layout": {
                "dockview": { "grid": { "width": 1280, "height": 800, "root": { "size": 420 } } },
                "graphs": { "filter": { "nodes": [] } },
            },
        });
        assert_eq!(stripped(&content), stripped(&resized));
    }

    #[test]
    fn graphs_count_as_pristine_only_when_both_are_still_seeded() {
        assert!(graphs_pristine(None));
        assert!(graphs_pristine(Some(&serde_json::json!({
            "filter": true,
            "synth": true,
        }))));
        assert!(!graphs_pristine(Some(&serde_json::json!({
            "filter": true,
            "synth": false,
        }))));
        // Present but unreadable: do not claim there is nothing to lose.
        assert!(!graphs_pristine(Some(&serde_json::json!("filter,synth"))));
    }
}
