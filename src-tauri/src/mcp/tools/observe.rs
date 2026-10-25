//! Observation tools: report what the user is looking at without changing it.

use serde_json::{json, Value};

use super::schema::{tool, ToolClass};

/// The read-only observation tools.
pub(super) fn tools() -> Vec<Value> {
    vec![
        tool(
            "get_state",
            "Get state",
            ToolClass::OBSERVE,
            "Observe the current project: the source (name, rate, channels, duration), \
             the analysis window and viewport, the shared analysis params, each analyzer's \
             effective options, the open Workbench tabs, the project name/path/dirty flag, \
             the annotations + focused annotation id, and the filter + output settings. \
             Start here to see what the user is looking at.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_analyzers",
            "List analyzers",
            ToolClass::OBSERVE,
            "List every analyzer tool (id, title, description, section, keywords) plus \
             its per-tool option keys and defaults, so you know which `run_analysis` ids \
             and options exist. Call `get_analyzer` for one tool's full option metadata \
             and the summary keys it returns.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "get_analyzer",
            "Get analyzer",
            ToolClass::OBSERVE,
            "One analyzer's detail: description, about copy, section, keywords, option \
             metadata (key, label, default, min, max, step, unit, help), and the summary \
             item keys it returns. Use it before passing `options` to `run_analysis` / \
             `set_tool_options`.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "An analyzer id from list_analyzers." },
                },
                "required": ["id"],
                "additionalProperties": false,
            }),
        ),
    ]
}
