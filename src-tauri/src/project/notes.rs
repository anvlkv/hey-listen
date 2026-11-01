//! Parsing the note objects a script supplies (`save_project` / `project --notes` /
//! `notes --add`).
//!
//! Notes cross the wire as JSON objects with the project file's field names. Ids and
//! timestamps are filled when omitted, so a caller only needs the meaningful fields
//! (`timeSecs`, `body`, optionally `title` / `range` / `tool`). The generated id carries
//! the process id as well as the clock, so two runs in the same millisecond still get
//! distinct ids.

use serde_json::{json, Value};

use super::Note;

/// Parse an array of note objects, filling `id` / `createdMs` / `updatedMs` / `body`.
pub fn parse_notes(value: Option<&Value>, now_ms: u64) -> Result<Vec<Note>, String> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(Vec::new());
    };
    let items = value.as_array().ok_or("`notes` must be an array")?;
    let mut notes = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let mut object = item
            .as_object()
            .cloned()
            .ok_or_else(|| format!("note {index} must be an object"))?;
        object.entry("id").or_insert_with(|| {
            json!(format!(
                "headless-{now_ms:x}-{:x}-{index}",
                std::process::id()
            ))
        });
        object.entry("createdMs").or_insert_with(|| json!(now_ms));
        object.entry("updatedMs").or_insert_with(|| json!(now_ms));
        object.entry("body").or_insert_with(|| json!(""));
        let note: Note = serde_json::from_value(Value::Object(object))
            .map_err(|err| format!("invalid note {index}: {err}"))?;
        notes.push(note);
    }
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::parse_notes;

    #[test]
    fn ids_and_timestamps_are_filled_and_ids_stay_unique() {
        let value = serde_json::json!([
            { "body": "a", "timeSecs": 0.1 },
            { "title": "t", "body": "b", "timeSecs": 0.2, "tool": "spectrum" }
        ]);
        let notes = parse_notes(Some(&value), 7).expect("valid notes");
        assert_eq!(notes.len(), 2);
        assert!(notes[0].id.starts_with("headless-"));
        assert_ne!(notes[0].id, notes[1].id);
        assert_eq!(notes[0].created_ms, 7);
        assert_eq!(notes[1].title.as_deref(), Some("t"));
        assert!(notes[1].tool.is_some());
    }

    #[test]
    fn a_non_array_is_an_error() {
        assert!(parse_notes(Some(&serde_json::json!({})), 1).is_err());
    }
}
