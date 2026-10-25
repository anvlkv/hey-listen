//! Shared shape helpers for the tool entries: the per-tool constructor, the
//! `ToolClass` annotation defaults, and the `target` property every tool advertises.

use serde_json::{json, Value};

/// MCP behaviour hints, grouped so every tool states them consistently instead of
/// copying four booleans. They are **hints** — the app still prompts before replacing a
/// source and `run_analysis` still writes params unless `transient: true`.
#[derive(Clone, Copy)]
pub(super) struct ToolClass {
    read_only: bool,
    destructive: bool,
    idempotent: bool,
    open_world: bool,
}

impl ToolClass {
    /// Reads state, changes nothing.
    pub(super) const OBSERVE: Self = Self {
        read_only: true,
        destructive: false,
        idempotent: true,
        open_world: false,
    };
    /// Runs an analysis or computes a value; writes only the analysis setup.
    pub(super) const COMPUTE: Self = Self {
        read_only: false,
        destructive: false,
        idempotent: true,
        open_world: false,
    };
    /// Changes analysis/view settings on the project.
    pub(super) const SETTINGS: Self = Self::COMPUTE;
    /// Starts playback.
    pub(super) const PREVIEW: Self = Self {
        read_only: false,
        destructive: false,
        idempotent: false,
        open_world: false,
    };
    /// Stops playback or capture (safe to repeat).
    pub(super) const STOP: Self = Self {
        read_only: false,
        destructive: false,
        idempotent: true,
        open_world: false,
    };
    /// Replaces the project/source (destructive, not idempotent).
    pub(super) const REPLACE: Self = Self {
        read_only: false,
        destructive: true,
        idempotent: false,
        open_world: true,
    };
    /// Writes a file outside the app.
    pub(super) const SAVE: Self = Self {
        read_only: false,
        destructive: false,
        idempotent: true,
        open_world: true,
    };
    /// Creates or patches an annotation.
    pub(super) const NOTE_WRITE: Self = Self {
        read_only: false,
        destructive: false,
        idempotent: true,
        open_world: false,
    };
    /// Removes an annotation.
    pub(super) const NOTE_DELETE: Self = Self {
        read_only: false,
        destructive: true,
        idempotent: true,
        open_world: false,
    };
    /// Starts live capture from a device / process.
    pub(super) const CAPTURE_START: Self = Self {
        read_only: false,
        destructive: false,
        idempotent: false,
        open_world: true,
    };
    /// Stops live capture (safe to repeat).
    pub(super) const CAPTURE_STOP: Self = Self {
        read_only: false,
        destructive: false,
        idempotent: true,
        open_world: true,
    };
    /// Exports a theme/template file.
    pub(super) const THEME_EXPORT: Self = Self::SAVE;
    /// Imports a theme/template file (may overwrite one with the same id).
    pub(super) const THEME_IMPORT: Self = Self {
        read_only: false,
        destructive: true,
        idempotent: true,
        open_world: true,
    };
}

/// Build one tool entry in the shape `tools/list` returns, with its title and hints.
pub(super) fn tool(
    name: &str,
    title: &str,
    class: ToolClass,
    description: &str,
    input_schema: Value,
) -> Value {
    json!({
        "name": name,
        "title": title,
        "description": description,
        "annotations": {
            "readOnlyHint": class.read_only,
            "destructiveHint": class.destructive,
            "idempotentHint": class.idempotent,
            "openWorldHint": class.open_world,
        },
        "inputSchema": input_schema,
    })
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
