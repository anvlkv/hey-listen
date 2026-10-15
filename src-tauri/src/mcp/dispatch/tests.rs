//! Unit tests for the headless dispatch table (split out of the module).

use serde_json::{json, Value};

use crate::audio::analysis::WindowKind;

use super::shape::{compact, decimate};
use super::HeadlessSession;

#[test]
fn ui_only_tools_require_the_app() {
    let mut session = HeadlessSession::default();
    for tool in [
        "open_tool",
        "get_graph",
        "set_synth_graph",
        "save_project",
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

#[test]
fn compact_collapses_long_numeric_arrays() {
    let value = json!({ "values": (0..100).map(|n| n as f64).collect::<Vec<_>>() });
    let out = compact(value);
    assert_eq!(out["values"]["length"], 100);
    assert_eq!(out["values"]["min"], 0.0);
    assert_eq!(out["values"]["max"], 99.0);
    assert_eq!(out["values"]["argmin"], 0);
    assert_eq!(out["values"]["argmax"], 99);
    assert!(out["values"].get("nulls").is_none());
}

#[test]
fn compact_surfaces_gaps_in_a_long_array() {
    // A pitch track with one voiced frame out of 511 must be visible at a glance.
    let mut values: Vec<Value> = vec![Value::Null; 511];
    values[300] = json!(220.0);
    let out = compact(json!({ "values": values }));
    assert_eq!(out["values"]["length"], 511);
    assert_eq!(out["values"]["nulls"], 510);
    assert_eq!(out["values"]["min"], 220.0);
    assert_eq!(out["values"]["max"], 220.0);
    assert_eq!(out["values"]["argmin"], 300);
    assert_eq!(out["values"]["argmax"], 300);
}

#[test]
fn compact_reduces_other_long_arrays_to_their_length() {
    let values: Vec<Value> = (0..20).map(|n| json!(format!("f{n}"))).collect();
    let out = compact(json!({ "labels": values }));
    assert_eq!(out["labels"]["length"], 20);
}

#[test]
fn decimate_strides_keeping_first_and_last() {
    let value = json!({ "values": (0..100).map(|n| n as f64).collect::<Vec<_>>() });
    let out = decimate(value, 10);
    let values = out["values"].as_array().unwrap();
    assert_eq!(values.len(), 10);
    assert_eq!(values[0], 0.0);
    assert_eq!(values[9], 99.0);
    // A uniform stride of 11: index 1 lands on round(11) = 11.
    assert_eq!(values[1], 11.0);
    // Short arrays pass through untouched.
    let short = decimate(json!({ "values": [1.0, 2.0, 3.0] }), 10);
    assert_eq!(short["values"].as_array().unwrap().len(), 3);
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

#[test]
fn run_analysis_echoes_settings_and_transient_does_not_write_back() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 1.0 }),
        )
        .unwrap();

    // Transient: params / window apply to this call only.
    let result = session
        .dispatch(
            "run_analysis",
            json!({
                "tool": "spectrum",
                "params": { "fftSize": 4096 },
                "transient": true,
                "start": 0.0,
                "end": 0.5,
            }),
        )
        .unwrap();
    // The envelope echoes the effective settings the call ran with…
    assert_eq!(result["params"]["fftSize"], 4096);
    assert_eq!(result["window"]["end"], 0.5);
    // …but a transient call does not write them back to the session.
    assert_eq!(session.params.fft_size, 2048);
    assert_eq!(session.window, (0.0, 1.0));
    // The `tool` tag lives in the result, not duplicated on the envelope.
    assert_eq!(result["result"]["tool"], "spectrum");
    assert!(result.get("tool").is_none());

    // A non-transient call persists the override.
    let result = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "spectrum", "params": { "fftSize": 4096 } }),
        )
        .unwrap();
    assert_eq!(result["params"]["fftSize"], 4096);
    assert_eq!(session.params.fft_size, 4096);
}
