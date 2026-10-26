//! Unit tests for the headless dispatch table (split out of the module).

use serde_json::{json, Value};

use crate::audio::analysis::WindowKind;

use super::HeadlessSession;

mod analysis;
mod modulation;
mod project;
mod shaping;

#[test]
fn ui_only_tools_require_the_app() {
    let mut session = HeadlessSession::default();
    for tool in [
        "open_tool",
        "get_graph",
        "set_synth_graph",
        "preview",
        "set_theme",
        "import_theme",
        "export_theme",
        "list_notes",
        "get_note",
        "create_note",
        "update_note",
        "delete_note",
        "set_focused_note",
    ] {
        let err = session.dispatch(tool, json!({})).unwrap_err();
        assert!(err.contains("requires the app"), "{tool}: {err}");
    }
}

#[test]
fn set_filter_graph_installs_and_clears_a_filter() {
    let mut session = HeadlessSession::default();

    // A filter with a global input compiles and is reported as enabled.
    let gain = json!({
        "nodes": [
            { "id": "in", "kind": "input", "params": [] },
            { "id": "g", "kind": "gain", "params": [0.5] },
            { "id": "out", "kind": "output", "params": [] },
        ],
        "edges": [
            { "from": "in", "from_port": 0, "to": "g", "to_port": 0 },
            { "from": "g", "from_port": 0, "to": "out", "to_port": 0 },
        ],
    });
    let installed = session
        .dispatch(
            "set_filter_graph",
            json!({ "graph": gain, "enabled": true }),
        )
        .unwrap();
    assert_eq!(installed["filter"]["enabled"], true);
    assert_eq!(
        session.dispatch("get_state", json!({})).unwrap()["filter"]["enabled"],
        true
    );

    // `enabled: false` (or a null graph) bypasses it.
    session
        .dispatch("set_filter_graph", json!({ "enabled": false }))
        .unwrap();
    assert_eq!(
        session.dispatch("get_state", json!({})).unwrap()["filter"]["enabled"],
        false
    );
}

#[test]
fn set_filter_graph_rejects_a_graph_without_an_input() {
    let mut session = HeadlessSession::default();
    // A synth-style graph (no `input` anchor) is not a valid filter.
    let err = session
        .dispatch(
            "set_filter_graph",
            json!({
                "graph": {
                    "nodes": [
                        { "id": "osc", "kind": "sine", "params": [440.0] },
                        { "id": "out", "kind": "output", "params": [] },
                    ],
                    "edges": [
                        { "from": "osc", "from_port": 0, "to": "out", "to_port": 0 },
                    ],
                },
            }),
        )
        .unwrap_err();
    assert!(!err.is_empty());
}

#[test]
fn get_state_reports_headless() {
    let mut session = HeadlessSession::default();
    let state = session.dispatch("get_state", json!({})).unwrap();
    assert_eq!(state["headless"], true);
    assert!(state["source"].is_null());
    assert_eq!(state["params"]["fftSize"], 2048);
}

#[test]
fn set_tool_options_accepts_aliases_and_rejects_unknown_keys() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "set_tool_options",
            json!({
                "tool": "pitchYin",
                "options": { "min_f0_hz": 50, "maxF0Hz": 4000 },
            }),
        )
        .expect("aliases are accepted");
    let state = session.dispatch("get_state", json!({})).unwrap();
    assert_eq!(state["toolOptions"]["pitchYin"]["minF0Hz"], 50.0);
    assert_eq!(state["toolOptions"]["pitchYin"]["maxF0Hz"], 4000.0);

    let error = session
        .dispatch(
            "set_tool_options",
            json!({ "tool": "pitchYin", "options": { "nope": 1 } }),
        )
        .unwrap_err();
    assert!(error.contains("unknown option"), "{error}");

    let error = session
        .dispatch(
            "set_tool_options",
            json!({ "tool": "pitchYin", "options": { "minF0Hz": "low" } }),
        )
        .unwrap_err();
    assert!(error.contains("must be a number"), "{error}");
}

#[test]
fn run_analysis_without_a_source_fails() {
    let mut session = HeadlessSession::default();
    let err = session
        .dispatch("run_analysis", json!({ "tool": "spectrum" }))
        .unwrap_err();
    assert!(err.contains("no audio source"), "{err}");
}

#[test]
fn shared_params_merge_partially() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "set_shared_params",
            json!({ "params": { "fftSize": 4096, "windowFn": "blackman" } }),
        )
        .unwrap();
    assert_eq!(session.params.fft_size, 4096);
    assert_eq!(session.params.hop, 0.25); // untouched
    assert!(matches!(session.params.window_fn, WindowKind::Blackman));
}

/// A synth graph that renders a 440 Hz sine (`sine -> output`).
fn sine_graph_value() -> Value {
    json!({
        "nodes": [
            { "id": "osc", "kind": "sine", "params": [440.0] },
            { "id": "out", "kind": "output", "params": [] },
        ],
        "edges": [ { "from": "osc", "from_port": 0, "to": "out", "to_port": 0 } ],
    })
}
