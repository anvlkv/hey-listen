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

/// The path at which two signatures first differ (`layout.popouts[0]`, `name`), or `None`
/// when they are equal.
///
/// A project that reads dirty is a question the log has to answer without a debugger: the
/// line reports this path, so the next CI run names the content that moved instead of
/// leaving two JSON blobs to diff.
pub(super) fn first_difference(a: &Value, b: &Value) -> Option<String> {
    let mut path = String::new();
    differs(a, b, &mut path).then(|| {
        if path.is_empty() {
            "(root)".to_string()
        } else {
            path
        }
    })
}

/// Walk two values, collecting the path of the first difference into `path`.
fn differs(a: &Value, b: &Value, path: &mut String) -> bool {
    match (a, b) {
        (Value::Object(a), Value::Object(b)) => {
            // Sorted and deduped, so both sides visit the keys in the same order.
            let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
            keys.sort_unstable();
            keys.dedup();
            for key in keys {
                let mark = path.len();
                if !path.is_empty() && !path.ends_with(']') {
                    path.push('.');
                }
                path.push_str(key);
                let differ = match (a.get(key), b.get(key)) {
                    (Some(a), Some(b)) => differs(a, b, path),
                    // A key on one side only is a difference at the key itself.
                    _ => true,
                };
                if differ {
                    return true;
                }
                path.truncate(mark);
            }
            false
        }
        (Value::Array(a), Value::Array(b)) => {
            for index in 0..a.len().max(b.len()) {
                let mark = path.len();
                path.push_str(&format!("[{index}]"));
                let differ = match (a.get(index), b.get(index)) {
                    (Some(a), Some(b)) => differs(a, b, path),
                    _ => true,
                };
                if differ {
                    return true;
                }
                path.truncate(mark);
            }
            false
        }
        (a, b) => a != b,
    }
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
    fn the_first_difference_names_the_path_that_moved() {
        let base = serde_json::json!({
            "name": "song",
            "layout": { "popouts": [], "graphs": { "filter": null } },
        });
        let mut current = base.clone();
        current["layout"]["popouts"] = serde_json::json!(["spectrum"]);
        assert_eq!(
            first_difference(&base, &current).as_deref(),
            Some("layout.popouts[0]")
        );
        assert_eq!(first_difference(&base, &base), None);

        // A key that exists on one side only is where the walk stops.
        let mut shorter = base.clone();
        shorter["layout"].as_object_mut().unwrap().remove("graphs");
        assert_eq!(
            first_difference(&base, &shorter).as_deref(),
            Some("layout.graphs")
        );
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
