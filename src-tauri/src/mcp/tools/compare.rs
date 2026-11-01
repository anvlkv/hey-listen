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
        "Diff **the same analyzer** across two independently open projects, or against \
         the owner's **saved reference snapshot**. Returns \
         `{ tool, a, b, comparability, diff }`: each side carries its project, source shape, \
         window, params, effective options, canonical `summary` and (shaped) result; \
         `comparability` says whether the grids align, the **relative** `alignment` \
         (`aDuration`, `bDuration`, `bOffset`, the `common` span the delta covers), the \
         informational absolute-time `overlap`, every differing setting (`mismatches`), and \
         whether the filters differ; `diff` is the per-family delta (stats by default, \
         arrays with `includeData`) matched on the relative axis. `bOffset` shifts the \
         reference (positive = later) to fine-tune a match. B is **read-only**: the \
         comparison never changes the reference project's audio, window, params or tabs. \
         Both sides are the same tool — a different tool is not a comparison. Pass `with` a \
         label from `list_projects` (which reports each project's source shape, window, \
         filter presence and saved comparisons), or `saved: true` to use A's stored snapshot \
         (no second window needed; `list_projects` reports the snapshot). Headless, `with` is \
         instead the reference **project file path** (`.heyl`): the session's project is A and \
         the file's saved setup/window is B. Either way the last successful comparison is \
         stored in A, so `save_project` writes it and the app restores it as a compare tab. \
         The owner is `target` (default: focused).",
        json!({
            "type": "object",
            "properties": {
                "tool": {
                    "type": "string",
                    "description": "An analyzer id from list_analyzers (the same tool on both sides).",
                },
                "with": {
                    "type": "string",
                    "description": "The reference side: a project label from list_projects (app), or the reference project's .heyl path (headless). Required unless `saved`.",
                },
                "saved": {
                    "type": "boolean",
                    "description": "Use A's saved reference snapshot instead of a live project (the last comparison saved in the project). Ignores `with`.",
                },
                "bOffset": {
                    "type": "number",
                    "description": "Fine-tune offset δ in seconds: positive moves the reference later on the relative axis. Default 0 for a live reference; a saved reference defaults to its stored offset.",
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
            "required": ["tool"],
            "additionalProperties": false,
        }),
    )]
}
