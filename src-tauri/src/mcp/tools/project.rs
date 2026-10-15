//! Project file operations and the note catalog (app-only: a note lives in a
//! project).

use serde_json::{json, Value};

use super::schema::tool;

/// The project-file and note tools.
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
            "List every note in the project: id, time (source seconds), optional range, tool \
             (the analyzer it was taken from; absent = a Timeline note), title, markdown body, \
             and the frozen values snapshot. App-only (a note lives in a project).",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "get_note",
            "Read one note by `id`.",
            json!({
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "create_note",
            "Create a note anchored at `time` (source seconds), optionally a `range` span, and \
             optionally tied to the analyzer `tool` it was taken from (omit for a Timeline \
             note). `title` is plain text, `body` is markdown. The frozen `values` snapshot is \
             captured from the target chart when it is open. App-only.",
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
                    "tool": { "type": "string", "description": "An analyzer id the note hangs off (default: a Timeline note)." },
                    "title": { "type": "string" },
                    "body": { "type": "string", "description": "Markdown body." },
                },
                "required": ["time"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "update_note",
            "Patch a note by `id`: `title` / `body` / `time` / `range` / `tool`. Pass \
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
            "Remove a note by `id`. App-only.",
            json!({
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_focused_note",
            "Focus one note (`id`) or clear the focus (`null`). The focused note is drawn on \
             every time-based chart. App-only.",
            json!({
                "type": "object",
                "properties": { "id": { "type": ["string", "null"] } },
                "required": ["id"],
                "additionalProperties": false,
            }),
        ),
    ]
}
