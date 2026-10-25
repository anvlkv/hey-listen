//! Source + analysis control: load/clear the source, run analyzers, and edit the
//! analysis window, timeline view, shared params, and per-tool options.

use serde_json::{json, Value};

use super::schema::{tool, ToolClass};

/// The source and analysis-control tools.
pub(super) fn tools() -> Vec<Value> {
    vec![
        tool(
            "open_audio_file",
            "Open audio file",
            ToolClass::REPLACE,
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
            "Close source",
            ToolClass::REPLACE,
            "Drop the current source (the timeline becomes empty).",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "render_synth",
            "Render synth",
            ToolClass::REPLACE,
            "Render the Synth graph to audio and adopt it as the source. Pass `replace: true` \
             to skip the confirmation the UI would show. In headless mode pass `graph` \
             (there is no synth editor).",
            json!({
                "type": "object",
                "properties": {
                    "seconds": { "type": "number", "description": "Length to render (default 5)." },
                    "replace": { "type": "boolean" },
                    "graph": {
                        "type": "object",
                        "description": "Headless only: the synth graph to render, as a `{ nodes, edges }` spec (nodes carry `kind` + positional `params`). Ignored by the app, which renders its synth editor graph.",
                    },
                },
                "additionalProperties": false,
            }),
        ),
        tool(
            "run_analysis",
            "Run analysis",
            ToolClass::COMPUTE,
            "Run an analyzer over the analysis window. The envelope always carries a \
             canonical `summary` (a `text` line plus labelled, unit-bearing items). The \
             result is **compact by default** — structured stats, dimensions, and bounded \
             previews rather than raw arrays; `includeData: true` returns the raw arrays \
             (with `maxPoints` to decimate them), and `summaryOnly: true` returns just the \
             summary. By default the call also opens (and focuses) the analyzer tab so the \
             user's window follows; pass `display: false` to compute without opening a tab. \
             Optionally overrides the window (`start`/`end`, source seconds), the shared \
             params, or the tool's own options — these are written back to the project \
             unless `transient: true`. Call `get_analyzer` for the option keys, their \
             ranges, and the summary keys the tool returns.",
            json!({
                "type": "object",
                "properties": {
                    "tool": { "type": "string", "description": "An analyzer id from list_analyzers." },
                    "start": { "type": "number", "description": "Analysis window start (source seconds)." },
                    "end": { "type": "number", "description": "Analysis window end (source seconds)." },
                    "params": { "type": "object", "description": "Partial shared params to apply first (written back unless `transient`)." },
                    "options": { "type": "object", "description": "Per-tool option overrides (written back unless `transient`). Keys are canonical camelCase; snake_case aliases are accepted, and an unknown key fails. `get_analyzer` reports each tool's option metadata." },
                    "display": { "type": "boolean", "description": "Open/focus the analyzer tab (default true). Set false to compute without touching the Workbench." },
                    "transient": { "type": "boolean", "description": "Apply `start`/`end`/`params`/`options` to this call only, without writing them back to the project (default false)." },
                    "summaryOnly": { "type": "boolean", "description": "Return only the summary, without `result` (default false). Mutually exclusive with `includeData`." },
                    "includeData": { "type": "boolean", "description": "Return the full result arrays (default false, compacted). Mutually exclusive with `summaryOnly`." },
                    "maxPoints": { "type": "integer", "minimum": 2, "description": "With `includeData`, decimate each returned array to at most this many points (striding, keeping the first and last)." },
                },
                "required": ["tool"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_analysis_window",
            "Set analysis window",
            ToolClass::SETTINGS,
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
            "Set timeline view",
            ToolClass::SETTINGS,
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
            "Set shared params",
            ToolClass::SETTINGS,
            "Update the shared analysis params (fftSize, hop, randomizedOverlap, windowFn, \
             channel, resampleTo, freqMinHz, freqMaxHz). Only the supplied keys change. \
             `hop` is the hop as a fraction of `fftSize` (`0.25` = 75% overlap, `1` = no \
             overlap), not a sample count.",
            json!({
                "type": "object",
                "properties": {
                    "params": {
                        "type": "object",
                        "description": "Partial shared params; `hop` is a fraction of `fftSize` (0.25 = 75% overlap).",
                    },
                },
                "required": ["params"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_tool_options",
            "Set tool options",
            ToolClass::SETTINGS,
            "Set one analyzer's own option values. Keys are canonical camelCase (e.g. \
             `nMels`, `yinThreshold`, `minF0Hz` / `maxF0Hz`, `barLength`); snake_case \
             aliases such as `n_mels` also work. Values must be numbers; an unknown key is \
             an error. Call `get_analyzer` for the keys, defaults, ranges, and units.",
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
    ]
}
