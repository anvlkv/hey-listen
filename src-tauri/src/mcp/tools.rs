//! The MCP tool catalog.
//!
//! Each tool is named, described, and given a JSON-Schema `inputSchema`. The
//! catalog is **static** (served without a running window, so `tools/list` always
//! answers), and the *implementations* live in the frontend (`src/state/mcp.ts`),
//! which runs each call against the same stores and commands the UI drives. Keep
//! the two in sync: a name here with no frontend handler returns an error, and a
//! frontend handler with no entry here is invisible to agents.

use serde_json::{json, Value};

/// The full tool list, in the shape `tools/list` returns.
pub fn list() -> Vec<Value> {
    vec![
        tool(
            "get_state",
            "Observe the current project: the source (name, rate, channels, duration), \
             the analysis window and viewport, the shared analysis params, the per-tool \
             options, the open Workbench tabs, the project name/path/dirty flag, and the \
             filter + output settings. Start here to see what the user is looking at.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_analyzers",
            "List every analyzer tool (id, title, description, section, keywords) so you \
             know which `run_analysis` ids exist.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "open_audio_file",
            "Open an audio file as the project source (replaces the whole timeline). \
             Pass `replace: true` to skip the confirmation the UI would show.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path to an audio file." },
                    "replace": { "type": "boolean", "description": "Replace the current source without prompting." },
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "close_source",
            "Drop the current source (the timeline becomes empty).",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "render_synth",
            "Render the Synth graph to audio and adopt it as the source. Pass `replace: true` \
             to skip the confirmation the UI would show.",
            json!({
                "type": "object",
                "properties": {
                    "seconds": { "type": "number", "description": "Length to render (default 5)." },
                    "replace": { "type": "boolean" },
                },
                "additionalProperties": false,
            }),
        ),
        tool(
            "run_analysis",
            "Open an analyzer tab and run it over the analysis window, returning its result. \
             Optionally overrides the window (`start`/`end`, source seconds), shared params, or \
             the tool's own options. The result is compacted (long arrays become min/max/length) \
             unless `includeData` is true. This is the tool that makes the user's window show \
             the analysis.",
            json!({
                "type": "object",
                "properties": {
                    "tool": { "type": "string", "description": "An analyzer id from list_analyzers." },
                    "start": { "type": "number", "description": "Analysis window start (source seconds)." },
                    "end": { "type": "number", "description": "Analysis window end (source seconds)." },
                    "params": { "type": "object", "description": "Partial shared params to apply first." },
                    "options": { "type": "object", "description": "Per-tool option overrides." },
                    "includeData": { "type": "boolean", "description": "Return the full result arrays (default false)." },
                },
                "required": ["tool"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_analysis_window",
            "Set the analysis window (the region every analyzer runs over), in source seconds.",
            json!({
                "type": "object",
                "properties": {
                    "start": { "type": "number" },
                    "end": { "type": "number" },
                },
                "required": ["start", "end"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_view",
            "Set the timeline's visible range (zoom/pan), in source seconds.",
            json!({
                "type": "object",
                "properties": {
                    "start": { "type": "number" },
                    "end": { "type": "number" },
                },
                "required": ["start", "end"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_shared_params",
            "Update the shared analysis params (fftSize, hop, randomizedOverlap, windowFn, \
             channel, resampleTo, freqMinHz, freqMaxHz). Only the supplied keys change.",
            json!({
                "type": "object",
                "properties": { "params": { "type": "object" } },
                "required": ["params"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_tool_options",
            "Set one analyzer's own option values (e.g. n_mels, yin_threshold, bar_length).",
            json!({
                "type": "object",
                "properties": {
                    "tool": { "type": "string" },
                    "options": { "type": "object" },
                },
                "required": ["tool", "options"],
                "additionalProperties": false,
            }),
        ),
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
            "Replace the filter graph (`filter` or `synth` editor layout) and/or toggle whether \
             it is applied. A `null` graph resets it to the identity seed.",
            json!({
                "type": "object",
                "properties": {
                    "graph": { "type": ["object", "null"], "description": "{ nodes, edges } editor layout, or null to reset." },
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
    ]
}

fn tool(name: &str, description: &str, input_schema: Value) -> Value {
    json!({ "name": name, "description": description, "inputSchema": input_schema })
}
