//! Exports (M12): save an analyzer's data (JSON / CSV) or its chart (PNG), or every
//! open analysis at once. The data exports are headless-capable; the chart image needs
//! the rendered canvas.

use serde_json::{json, Value};

use super::schema::{tool, ToolClass};

/// The export tools.
pub(super) fn tools() -> Vec<Value> {
    vec![
        tool(
            "export_analysis",
            "Export analysis data",
            ToolClass::SAVE,
            "Save one analyzer's result over the current window as a self-describing \
             **JSON provenance envelope** or a **wide-matrix CSV**. Returns the serialized \
             `text` (and `sidecar` for CSV) whether or not `path` is given, so a headless \
             caller can read the data without writing a file. CSV sidecar metadata is \
             written as `<name>.meta.json` unless `includeSidecar: false`.",
            json!({
                "type": "object",
                "properties": {
                    "tool": { "type": "string", "description": "An analyzer id from list_analyzers." },
                    "format": { "type": "string", "enum": ["json", "csv"], "description": "Data format (default `json`)." },
                    "path": { "type": "string", "description": "Destination file. Omit to only render the text." },
                    "includeSidecar": { "type": "boolean", "description": "Write the CSV provenance sidecar (default true)." },
                    "start": { "type": "number", "description": "Window start (source seconds; defaults to the current window)." },
                    "end": { "type": "number", "description": "Window end (source seconds; defaults to the current window)." },
                },
                "required": ["tool"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "export_chart",
            "Export analysis chart",
            ToolClass::SAVE,
            "Save an analyzer tab's chart as a PNG, exactly as rendered (theme and zoom \
             included). Requires the app — a headless host has no canvas.",
            json!({
                "type": "object",
                "properties": {
                    "tool": { "type": "string", "description": "An analyzer id whose tab is open." },
                    "path": { "type": "string", "description": "Destination .png file. Omit to open the save dialog." },
                },
                "required": ["tool"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "export_all",
            "Export all open analyses",
            ToolClass::SAVE,
            "Write every open analyzer tab (or, headless, an explicit `tools` list) to a \
             folder, one JSON and/or CSV file per tool. A CSV also writes its provenance \
             sidecar. The image export is per-tab (`export_chart`).",
            json!({
                "type": "object",
                "properties": {
                    "dir": { "type": "string", "description": "Destination folder (created when missing)." },
                    "formats": {
                        "type": "array",
                        "items": { "type": "string", "enum": ["json", "csv"] },
                        "description": "Formats to write (default both).",
                    },
                    "tools": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Headless only: the analyzer ids to export (there are no open tabs).",
                    },
                },
                "required": ["dir"],
                "additionalProperties": false,
            }),
        ),
    ]
}
