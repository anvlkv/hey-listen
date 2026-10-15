//! `notes` — list a saved project's notes (read-only).

use std::io::Write;

use serde_json::{json, Value};

use super::output::emit;

/// List a saved project's notes, sorted by time (read-only).
///
/// Decodes the `.heyl` container and reads its `NOTES` section. Prints one JSON line
/// per note (`--json`) or a table; a file with no notes prints nothing and exits `0`.
/// A missing / unreadable / non-project file is an `error` (exit `1`).
pub(super) fn run_notes(path: &str, json: bool, full: bool, out: &mut impl Write) -> i32 {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(err) => {
            emit(
                out,
                &json!({ "file": path, "error": err.to_string() }),
                false,
            );
            return 1;
        }
    };
    let mut notes = match crate::project::read_project(&mut file) {
        Ok(loaded) => loaded.notes,
        Err(err) => {
            emit(
                out,
                &json!({ "file": path, "error": err.to_string() }),
                false,
            );
            return 1;
        }
    };
    notes.sort_by(|a, b| a.time_secs.total_cmp(&b.time_secs));

    for note in &notes {
        if json {
            let mut value = serde_json::to_value(note).unwrap_or(Value::Null);
            if !full {
                if let Some(object) = value.as_object_mut() {
                    object.insert("body".to_string(), json!(excerpt(&note.body)));
                }
            }
            emit(out, &value, false);
        } else {
            let time = match &note.range {
                Some(range) => format!("{:.3}–{:.3}", range.start_secs, range.end_secs),
                None => format!("{:.3}", note.time_secs),
            };
            let label = match note.title.as_deref() {
                Some(title) if !title.is_empty() => title.to_string(),
                _ if full => note.body.replace('\n', " "),
                _ => excerpt(&note.body),
            };
            let values = note.values.as_ref().map(|v| v.text.as_str()).unwrap_or("");
            let _ = writeln!(
                out,
                "{time}\t{}\t{label}\t{values}",
                note.tool.as_deref().unwrap_or("-"),
            );
        }
    }
    0
}

/// A one-line excerpt of a markdown body for the table / default JSON output.
fn excerpt(body: &str) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let mut short: String = line.chars().take(60).collect();
    if line.chars().count() > 60 {
        short.push('…');
    }
    short
}
