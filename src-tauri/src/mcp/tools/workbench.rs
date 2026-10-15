//! Workbench control: open/close tabs, edit the filter + synth graphs, drive
//! preview playback and output, and enumerate/start live capture devices.

use serde_json::{json, Value};

use super::schema::tool;

/// The Workbench, graph, preview, and capture tools.
pub(super) fn tools() -> Vec<Value> {
    vec![
        tool(
            "open_tool",
            "Open (or focus) a Workbench tab: an analyzer id, or `filter` / `synth`.",
            json!({
                "type": "object",
                "properties": { "tool": { "type": "string" } },
                "required": ["tool"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "close_tool",
            "Close a Workbench tab by id.",
            json!({
                "type": "object",
                "properties": { "tool": { "type": "string" } },
                "required": ["tool"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "get_graph",
            "Read a graph editor's state (`filter` or `synth`) as editor nodes + edges.",
            json!({
                "type": "object",
                "properties": { "graph": { "type": "string", "enum": ["filter", "synth"] } },
                "required": ["graph"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_filter_graph",
            "Replace the filter graph and/or toggle whether it is applied. The graph runs \
             upstream of preview and every analyzer. In headless mode pass `graph` as a \
             `{ nodes, edges }` spec directly (there is no filter editor); a null or empty \
             graph clears it.",
            json!({
                "type": "object",
                "properties": {
                    "graph": { "type": ["object", "null"], "description": "{ nodes, edges } editor layout, or (headless) a GraphSpec taken directly; null/empty clears the filter." },
                    "enabled": { "type": "boolean", "description": "Whether the filter is applied to preview/analysis." },
                },
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_synth_graph",
            "Replace the synth graph editor layout ({ nodes, edges }).",
            json!({
                "type": "object",
                "properties": { "graph": { "type": "object" } },
                "required": ["graph"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "preview",
            "Preview playback of a region (defaults to the analysis window) through the core.",
            json!({
                "type": "object",
                "properties": {
                    "start": { "type": "number" },
                    "end": { "type": "number" },
                    "loop": { "type": "boolean", "description": "Loop the region (default true)." },
                    "speed": {
                        "type": "number",
                        "description": "Varispeed playback rate, 0.25–4 (default 1). Shifts pitch; analysis is unaffected.",
                    },
                },
                "additionalProperties": false,
            }),
        ),
        tool(
            "stop_preview",
            "Stop preview playback.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "set_output_gain",
            "Set the preview output gain (linear, ≥ 0).",
            json!({
                "type": "object",
                "properties": { "gain": { "type": "number" } },
                "required": ["gain"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "list_output_devices",
            "List the audio output devices preview can play through.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_input_devices",
            "List the capture devices (microphones and system-output loopback).",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_processes",
            "List the processes available for per-process capture.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "start_capture",
            "Start a live capture as the source: kind `mic` / `system` / `process` / `mix`.",
            json!({
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "enum": ["mic", "system", "process", "mix"] },
                    "deviceId": { "type": ["string", "null"] },
                    "mixMicDeviceId": { "type": ["string", "null"] },
                    "mixSystemDeviceId": { "type": ["string", "null"] },
                    "targetPid": { "type": ["integer", "null"] },
                    "gain": { "type": "number" },
                },
                "required": ["kind"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "stop_capture",
            "Stop the running capture.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
    ]
}
