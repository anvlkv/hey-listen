//! Catalog coverage: every tool is titled and annotated, and `get_analyzer` agrees
//! with `list_analyzers` (M21).

use serde_json::{Map, Value};

use crate::audio::analyzers;

#[test]
fn every_tool_has_a_title_and_annotations() {
    let tools = super::list();
    assert!(!tools.is_empty());
    for tool in tools {
        let name = tool["name"].as_str().unwrap_or("");
        assert!(!name.is_empty());
        assert!(
            tool["title"]
                .as_str()
                .is_some_and(|title| !title.is_empty()),
            "{name}: no title"
        );
        for hint in [
            "readOnlyHint",
            "destructiveHint",
            "idempotentHint",
            "openWorldHint",
        ] {
            assert!(
                tool["annotations"][hint].is_boolean(),
                "{name}: missing {hint}"
            );
        }
    }
}

#[test]
fn tool_names_are_unique() {
    let tools = super::list();
    let mut names: Vec<&str> = tools
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    let count = names.len();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), count, "a tool name is registered twice");
}

#[test]
fn observe_tools_are_read_only_and_replacing_tools_are_destructive() {
    let tools = super::list();
    let find = |name: &str| tools.iter().find(|tool| tool["name"] == name).unwrap();
    for name in ["get_state", "list_analyzers", "get_analyzer", "get_note"] {
        assert_eq!(find(name)["annotations"]["readOnlyHint"], true, "{name}");
    }
    for name in ["open_audio_file", "open_project", "new_project"] {
        assert_eq!(find(name)["annotations"]["destructiveHint"], true, "{name}");
    }
    assert_eq!(find("run_analysis")["annotations"]["readOnlyHint"], false);
    assert_eq!(find("run_analysis")["annotations"]["idempotentHint"], true);
}

#[test]
fn run_analysis_is_not_destructive_and_compare_is_read_only() {
    let tools = super::list();
    let find = |name: &str| tools.iter().find(|tool| tool["name"] == name).unwrap();
    assert_eq!(
        find("compare_analysis")["annotations"]["readOnlyHint"],
        true
    );
    let schema = &find("compare_analysis")["inputSchema"];
    assert_eq!(schema["required"], serde_json::json!(["tool", "with"]));
    // Every tool carries the shared `target` property (multi-project addressing).
    assert_eq!(schema["properties"]["target"]["type"], "string");
}

#[test]
fn get_analyzer_agrees_with_list_analyzers() {
    for item in analyzers::list() {
        let id = item["id"].as_str().unwrap();
        let detail = analyzers::detail(id).expect("every listed analyzer has detail");
        assert_eq!(detail["title"], item["title"], "{id}");
        assert_eq!(detail["section"], item["section"], "{id}");
        assert_eq!(detail["keywords"], item["keywords"], "{id}");
        assert!(
            detail["about"]
                .as_str()
                .is_some_and(|about| !about.is_empty()),
            "{id}: no about copy"
        );
        assert!(
            detail["summaryKeys"]
                .as_array()
                .is_some_and(|keys| !keys.is_empty()),
            "{id}: no summary keys"
        );

        // The compact list map is exactly the detail's key → default pairs.
        let mut defaults = Map::new();
        for option in detail["options"].as_array().unwrap() {
            let key = option["key"].as_str().unwrap().to_string();
            for field in ["label", "min", "max", "step", "help"] {
                assert!(!option[field].is_null(), "{id}.{key}: no {field}");
            }
            assert!(option["unit"].is_string() || option["unit"].is_null());
            defaults.insert(key, option["default"].clone());
        }
        assert_eq!(Value::Object(defaults), item["options"], "{id}");
    }
}
