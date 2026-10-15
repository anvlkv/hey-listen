//! Observation tools: report what the user is looking at without changing it.

use serde_json::{json, Value};

use super::schema::tool;

/// The read-only observation tools.
pub(super) fn tools() -> Vec<Value> {
    vec![
        tool(
            "get_state",
            "Observe the current project: the source (name, rate, channels, duration), \
             the analysis window and viewport, the shared analysis params, the per-tool \
             options, the open Workbench tabs, the project name/path/dirty flag, the \
             notes + focused note id, and the filter + output settings. Start here to see \
             what the user is looking at.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_analyzers",
            "List every analyzer tool (id, title, description, section, keywords) so you \
             know which `run_analysis` ids exist.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
    ]
}
