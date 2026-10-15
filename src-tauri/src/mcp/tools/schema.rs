//! Shared shape helpers for the tool entries: the per-tool constructor and the
//! `target` property every tool advertises.

use serde_json::{json, Value};

/// Build one tool entry in the shape `tools/list` returns.
pub(super) fn tool(name: &str, description: &str, input_schema: Value) -> Value {
    json!({ "name": name, "description": description, "inputSchema": input_schema })
}

/// Add the shared `target` property to a tool's `inputSchema`.
pub(super) fn add_target_property(tool: &mut Value) {
    let Some(properties) = tool
        .get_mut("inputSchema")
        .and_then(|schema| schema.get_mut("properties"))
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    properties.insert(
        "target".to_string(),
        json!({
            "type": "string",
            "description": "Which project window to drive (a label from list_projects). \
                            Defaults to the focused window."
        }),
    );
}
