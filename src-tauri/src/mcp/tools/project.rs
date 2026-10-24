//! Project file operations and the annotation catalog (app-only: an annotation lives
//! in a project). The tool ids keep the M14 `*_note` spelling; these are project
//! annotations, not `noteMetrics`' detected note segments.

use serde_json::{json, Value};

use super::schema::tool;

/// The project-file and annotation tools.
pub(super) fn tools() -> Vec<Value> {
    vec![
        tool(
            "save_project",
            "Save the project. With `path`, saves there; without, saves to the current path \
             (or prompts, as the UI does).",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Destination .heyl path." },
                },
                "additionalProperties": false,
            }),
        ),
        tool(
            "open_project",
            "Open a .heyl project file, replacing the current project.",
            json!({
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "new_project",
            "Start a fresh project (drops the source, graphs, setup, and Workbench tabs).",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_projects",
            "List every open project window (label, display name, focused) so you can pass a \
             `target` to any other tool and address a specific project instead of the focused \
             one. Answered by the server itself.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_notes",
            "List every annotation in the project (stored as a note): id, time (source \
             seconds), optional range, tool (the analyzer it was taken from; absent = a \
             Timeline annotation), title, markdown body, and the frozen values snapshot. \
             App-only (an annotation lives in a project). Not the detected note segments \
             returned by the `noteMetrics` analyzer.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "get_note",
            "Read one annotation by `id`.",
            json!({
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "create_note",
            "Create an annotation anchored at `time` (source seconds), optionally a `range` \
             span, and optionally tied to the analyzer `tool` it was taken from (omit for a \
             Timeline annotation). `title` is plain text, `body` is markdown. The frozen \
             `values` snapshot is captured from the target chart when it is open. App-only.",
            json!({
                "type": "object",
                "properties": {
                    "time": { "type": "number", "description": "Anchor instant in source seconds." },
                    "range": {
                        "type": "object",
                        "description": "Optional span; absent = a point anchor.",
                        "properties": { "startSecs": { "type": "number" }, "endSecs": { "type": "number" } },
                        "additionalProperties": false,
                    },
                    "tool": { "type": "string", "description": "An analyzer id the annotation hangs off (default: a Timeline annotation)." },
                    "title": { "type": "string" },
                    "body": { "type": "string", "description": "Markdown body." },
                },
                "required": ["time"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "update_note",
            "Patch an annotation by `id`: `title` / `body` / `time` / `range` / `tool`. Pass \
             `recomputeValues: true` to refresh the frozen values snapshot from the live \
             chart. Only the supplied keys change. App-only.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "title": { "type": ["string", "null"] },
                    "body": { "type": "string" },
                    "time": { "type": "number" },
                    "range": { "type": ["object", "null"] },
                    "tool": { "type": ["string", "null"] },
                    "recomputeValues": { "type": "boolean" },
                },
                "required": ["id"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "delete_note",
            "Remove an annotation by `id`. App-only.",
            json!({
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_focused_note",
            "Focus one annotation (`id`) or clear the focus (`null`). The focused annotation \
             is drawn on every time-based chart. App-only.",
            json!({
                "type": "object",
                "properties": { "id": { "type": ["string", "null"] } },
                "required": ["id"],
                "additionalProperties": false,
            }),
        ),
    ]
}
