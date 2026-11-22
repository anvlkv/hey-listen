//! Workbench control: open/close tabs, edit the filter + synth graphs, drive
//! preview playback and output, and enumerate/start live capture devices.

use serde_json::{json, Value};
use strum::VariantNames;

use super::schema::{tool, ToolClass};
use crate::audio::analyzers::ToolId;
use crate::audio::capture::CaptureKind;

/// The Workbench, graph, preview, and capture tools.
pub(super) fn tools() -> Vec<Value> {
    vec![
        tool(
            "open_tool",
            "Open tool",
            ToolClass::SETTINGS,
            "Open (or focus) a Workbench tab: an analyzer id, or `filter` / `synth`. \
             The optional `position` places the tab: omit it for a tab in the main group, \
             or name a `referenceGroup` (a group id from `get_state.workbench.groups`, or \
             a tool id open in that group) and a `direction` (`within` = a tab there; \
             `left` / `right` / `above` / `below` split that group) to lay analyzers out \
             side by side. Ignored headless, where there is no webview: the tab is \
             recorded in the project's `SETUP.openTools`, which `get_state.openTools` \
             reports, `save_project` writes, and the app opens when the project loads.",
            json!({
                "type": "object",
                "properties": {
                    "tool": { "type": "string" },
                    "position": {
                        "type": "object",
                        "description": "App-only placement. Omitted = a tab in the main Workbench group.",
                        "properties": {
                            "referenceGroup": { "type": "string", "description": "A group id from get_state.workbench.groups, or a tool id open in that group." },
                            "direction": {
                                "type": "string",
                                "enum": ["within", "left", "right", "above", "below"],
                                "description": "`within` (default) adds a tab to the group; the others split it and place the tab on that side.",
                            },
                        },
                        "additionalProperties": false,
                    },
                },
                "required": ["tool"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "close_tool",
            "Close tool",
            ToolClass::SETTINGS,
            "Close a Workbench tab by id. Headless, this removes it from the project's \
             `SETUP.openTools`.",
            json!({
                "type": "object",
                "properties": { "tool": { "type": "string" } },
                "required": ["tool"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "get_graph",
            "Get graph",
            ToolClass::OBSERVE,
            "Read a graph editor (`filter` or `synth`) back as **DOT** — the canonical text \
             form — plus, in the app, the editor layout. `GraphSpec → DOT → GraphSpec` is \
             identity, so edit the text and send it back with `set_filter_graph` / \
             `render_synth`.",
            json!({
                "type": "object",
                "properties": {
                    "graph": {
                        "type": "string",
                        "enum": [ToolId::Filter.as_ref(), ToolId::Synth.as_ref()],
                    },
                },
                "required": ["graph"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "list_nodes",
            "List nodes",
            ToolClass::OBSERVE,
            "List the filter/synth node catalog: kind, label, category, port names, param \
             specs (key/default/min/max/step/unit) and hint. One Rust table feeds this, the \
             DOT parser and the editor palette, so a port or key you see here is the one DOT \
             accepts.",
            json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false,
            }),
        ),
        tool(
            "get_node",
            "Get node",
            ToolClass::OBSERVE,
            "Explain one node kind from `list_nodes`, with a **ready-to-paste DOT skeleton**: \
             the record label naming each port and every parameter at its default.",
            json!({
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "description": "A node kind from list_nodes." },
                },
                "required": ["kind"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_filter_graph",
            "Set filter graph",
            ToolClass::SETTINGS,
            "Replace the filter graph and/or toggle whether it is applied. The graph runs \
             upstream of preview and every analyzer. Send `graph` as a **DOT string** (the \
             canonical form; `get_graph` reads the current one back as DOT), or `graphFile` \
             for a `.dot` / `.gv` path. A legacy JSON `GraphSpec` object is still accepted. \
             `enabled: false`, a null/empty graph clears the filter.",
            json!({
                "type": "object",
                "properties": {
                    "graph": { "type": ["string", "object", "null"], "description": "DOT text (canonical), a legacy JSON GraphSpec, or null/empty to clear." },
                    "graphFile": { "type": "string", "description": "Path to a .dot / .gv (or legacy .json) graph file." },
                    "enabled": { "type": "boolean", "description": "Whether the filter is applied to preview/analysis." },
                },
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_synth_graph",
            "Set synth graph",
            ToolClass::SETTINGS,
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
            "Preview",
            ToolClass::PREVIEW,
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
            "Stop preview",
            ToolClass::STOP,
            "Stop preview playback.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "set_output_gain",
            "Set output gain",
            ToolClass::SETTINGS,
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
            "List output devices",
            ToolClass::OBSERVE,
            "List the audio output devices preview can play through.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_input_devices",
            "List input devices",
            ToolClass::OBSERVE,
            "List the capture devices (microphones and system-output loopback).",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_processes",
            "List processes",
            ToolClass::OBSERVE,
            "List the processes available for per-process capture.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "start_capture",
            "Start capture",
            ToolClass::CAPTURE_START,
            "Start a live capture as the source: kind `mic` / `system` / `process` / `mix`.",
            json!({
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "enum": CaptureKind::VARIANTS },
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
            "Stop capture",
            ToolClass::CAPTURE_STOP,
            "Stop the running capture.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
    ]
}
