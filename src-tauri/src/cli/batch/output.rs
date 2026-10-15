//! JSONL output: one self-describing result object per file/tool.

use std::io::Write;

use serde_json::Value;

/// Write one result object (compact JSONL, or pretty-printed).
pub(super) fn emit(out: &mut impl Write, value: &Value, pretty: bool) {
    let text = if pretty {
        serde_json::to_string_pretty(value)
    } else {
        serde_json::to_string(value)
    }
    .unwrap_or_default();
    let _ = writeln!(out, "{text}");
}
