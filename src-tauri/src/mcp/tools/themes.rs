//! Theme tools: inspect the theme catalog and the active preference, set it, and
//! import/export `.heyltheme` files.

use serde_json::{json, Value};

use super::schema::{tool, ToolClass};

/// The theme tools.
pub(super) fn tools() -> Vec<Value> {
    vec![
        tool(
            "list_themes",
            "List themes",
            ToolClass::OBSERVE,
            "List the available themes (id, name, description, base, builtin) and the active \
             theme preference (mode + dark/light slots), so you can reproduce the app's look. \
             Headless lists the bundled themes only.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "get_theme",
            "Get theme",
            ToolClass::OBSERVE,
            "Read a theme's full definition (`id`), or the active theme when `id` is omitted. \
             Also reports the active preference (mode + slots).",
            json!({
                "type": "object",
                "properties": { "id": { "type": "string", "description": "A theme id from list_themes (default: the active theme)." } },
                "additionalProperties": false,
            }),
        ),
        tool(
            "set_theme",
            "Set theme",
            ToolClass::SETTINGS,
            "Set the theme preference: `mode` (`auto` / `dark` / `light`) and/or the `darkThemeId` \
             / `lightThemeId` slots. Only the supplied keys change. Persisted app-level (not in \
             the project file).",
            json!({
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["auto", "dark", "light"] },
                    "darkThemeId": { "type": "string" },
                    "lightThemeId": { "type": "string" },
                },
                "additionalProperties": false,
            }),
        ),
        tool(
            "import_theme",
            "Import theme",
            ToolClass::THEME_IMPORT,
            "Import a `.heyltheme` file into the themes store and return its summary (`path`).",
            json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Absolute path to a .heyltheme file." } },
                "required": ["path"],
                "additionalProperties": false,
            }),
        ),
        tool(
            "export_theme",
            "Export theme",
            ToolClass::THEME_EXPORT,
            "Write a theme (the active one, or `id`) to a `.heyltheme` file at `path`.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Destination .heyltheme path." },
                    "id": { "type": "string", "description": "Theme to export (default: the active theme)." },
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        ),
    ]
}
