//! The comparison tool (M25): diff one analyzer across two open projects.
//!
//! App-only: a comparison needs two live project windows. The CLI's `compare`
//! subcommand is the windowless equivalent (two project files). See
//! `docs/comparison.md` → "MCP".

use serde_json::{json, Value};

use super::schema::{tool, ToolClass};

/// The comparison tool entry.
pub(super) fn tools() -> Vec<Value> {
    vec![tool(
        "compare_analysis",
        "Compare analysis",
        ToolClass::OBSERVE,
        "Diff **the same analyzer** across two independently open projects. Returns \
         `{ tool, a, b, comparability, diff }`: each side carries its project, source shape, \
         window, params, effective options, canonical `summary` and (shaped) result; \
         `comparability` says whether the grids align, their absolute-time `overlap`, every \
         differing setting (`mismatches`), and whether the filters differ; `diff` is the \
         per-family delta (stats by default, arrays with `includeData`). B is **read-only**: \
         the comparison never changes the reference project's audio, window, params or tabs. \
         Both sides are the same tool — a different tool is not a comparison. Requires the \
         app: pass `with` a label from `list_projects` (which reports each project's source \
         shape, window and filter presence). Headless has no second window — use the CLI \
         `compare` subcommand.",
        json!({
            "type": "object",
            "properties": {
                "tool": {
                    "type": "string",
                    "description": "An analyzer id from list_analyzers (the same tool on both sides).",
                },
                "with": {
                    "type": "string",
                    "description": "The reference project's label from list_projects.",
                },
                "includeData": {
                    "type": "boolean",
                    "description": "Return the raw result and delta arrays (default: compact results and delta stats only).",
                },
                "maxPoints": {
                    "type": "integer",
                    "minimum": 2,
                    "description": "With includeData, thin series/matrix arrays to at most this many points.",
                },
                "axis": {
                    "type": "string",
                    "enum": ["array", "compact"],
                    "description": "With includeData, spell a uniform time axis as `{ start, hop, length, end }`.",
                },
                "summaryOnly": {
                    "type": "boolean",
                    "description": "Return the side summaries and the diff summary only (no result arrays).",
                },
                "display": {
                    "type": "boolean",
                    "description": "Open/focus the compare view when the tool's family has one (default true).",
                },
            },
            "required": ["tool", "with"],
            "additionalProperties": false,
        }),
    )]
}
