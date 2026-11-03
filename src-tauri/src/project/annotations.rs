//! Parsing the annotation objects a script supplies (`save_project` / `project --annotations` /
//! `annotations --add`).
//!
//! Annotations cross the wire as JSON objects with the project file's field names. Ids and
//! timestamps are filled when omitted, so a caller only needs the meaningful fields
//! (`timeSecs`, `body`, optionally `title` / `range` / `tool`). The generated id carries
//! the process id as well as the clock, so two runs in the same millisecond still get
//! distinct ids.

use serde_json::{json, Value};

use super::Annotation;

/// Parse an array of annotation objects, filling `id` / `createdMs` / `updatedMs` / `body`.
pub fn parse_annotations(value: Option<&Value>, now_ms: u64) -> Result<Vec<Annotation>, String> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(Vec::new());
    };
    let items = value.as_array().ok_or("`annotations` must be an array")?;
    let mut annotations = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let mut object = item
            .as_object()
            .cloned()
            .ok_or_else(|| format!("annotation {index} must be an object"))?;
        object.entry("id").or_insert_with(|| {
            json!(format!(
                "headless-{now_ms:x}-{:x}-{index}",
                std::process::id()
            ))
        });
        object.entry("createdMs").or_insert_with(|| json!(now_ms));
        object.entry("updatedMs").or_insert_with(|| json!(now_ms));
        object.entry("body").or_insert_with(|| json!(""));
        let annotation: Annotation = serde_json::from_value(Value::Object(object))
            .map_err(|err| format!("invalid annotation {index}: {err}"))?;
        annotations.push(annotation);
    }
    Ok(annotations)
}

#[cfg(test)]
mod tests {
    use super::parse_annotations;

    #[test]
    fn ids_and_timestamps_are_filled_and_ids_stay_unique() {
        let value = serde_json::json!([
            { "body": "a", "timeSecs": 0.1 },
            { "title": "t", "body": "b", "timeSecs": 0.2, "tool": "spectrum" }
        ]);
        let annotations = parse_annotations(Some(&value), 7).expect("valid annotations");
        assert_eq!(annotations.len(), 2);
        assert!(annotations[0].id.starts_with("headless-"));
        assert_ne!(annotations[0].id, annotations[1].id);
        assert_eq!(annotations[0].created_ms, 7);
        assert_eq!(annotations[1].title.as_deref(), Some("t"));
        assert!(annotations[1].tool.is_some());
    }

    #[test]
    fn a_non_array_is_an_error() {
        assert!(parse_annotations(Some(&serde_json::json!({})), 1).is_err());
    }
}
