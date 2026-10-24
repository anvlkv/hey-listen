//! Unit tests for the headless dispatch table (split out of the module).

use serde_json::{json, Value};

use crate::audio::analysis::WindowKind;

use super::HeadlessSession;

mod shaping;

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

#[test]
fn frame_rms_options_flow_through_the_headless_session() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 1.0 }),
        )
        .unwrap();
    session
        .dispatch(
            "set_tool_options",
            json!({ "tool": "frameRms", "options": { "frame_ms": 20, "hop_ms": 10 } }),
        )
        .expect("snake_case aliases are accepted");

    let envelope = session
        .dispatch("run_analysis", json!({ "tool": "frameRms" }))
        .unwrap();
    assert_eq!(envelope["result"]["tool"], "frameRms");
    // The configured frame and hop reach the result in samples.
    assert_eq!(envelope["result"]["frameSize"], 960);
    assert_eq!(envelope["result"]["hopSize"], 480);
    assert_eq!(envelope["options"]["frameMs"], 20.0);
    assert_eq!(envelope["options"]["hopMs"], 10.0);
}

#[test]
fn note_metrics_options_flow_through_the_headless_session() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 1.0 }),
        )
        .unwrap();
    session
        .dispatch(
            "set_tool_options",
            json!({
                "tool": "noteMetrics",
                "options": {
                    "gate_db": 40,
                    "min_note_ms": 15,
                    "envelope_points": 5,
                    "pitch_frame_ms": 30,
                    "pitch_hop_ms": 4,
                    "min_f0_hz": 100,
                    "max_f0_hz": 1000,
                },
            }),
        )
        .expect("snake_case aliases are accepted");

    let metrics = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "noteMetrics", "includeData": true }),
        )
        .unwrap();
    assert_eq!(metrics["result"]["tool"], "noteMetrics");
    // A continuous 1 s tone is one note, and the configured options reach the result.
    assert_eq!(metrics["result"]["noteCount"], 1);
    assert_eq!(metrics["result"]["gapCount"], 0);
    assert_eq!(metrics["result"]["referenceNoteIndex"], 0);
    assert_eq!(
        metrics["result"]["envelopePositions"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        metrics["result"]["notes"][0]["envelopeDb"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(metrics["options"]["gateDb"], 40.0);
    assert_eq!(metrics["options"]["minNoteMs"], 15.0);
    assert_eq!(metrics["options"]["envelopePoints"], 5);
    assert_eq!(metrics["options"]["pitchFrameMs"], 30.0);
    assert_eq!(metrics["options"]["pitchHopMs"], 4.0);
    assert_eq!(metrics["options"]["minF0Hz"], 100.0);
    assert_eq!(metrics["options"]["maxF0Hz"], 1000.0);
    // M19's per-note proxies travel with the note records under `includeData`.
    let note = &metrics["result"]["notes"][0];
    assert!(note["voicedFraction"].as_f64().is_some_and(|f| f > 0.9));
    assert!(note["f0MedianHz"]
        .as_f64()
        .is_some_and(|f| (f - 440.0).abs() < 5.0));
    assert!(note["jitterProxyCents"].as_f64().is_some());
    assert!(note["shimmerProxyDb"].as_f64().is_some());
    assert!(note["hnrProxy"].as_f64().is_some_and(|v| v > 0.5));
}

#[test]
fn analysis_times_are_rebased_onto_source_seconds() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 1.0 }),
        )
        .unwrap();

    // A window that does not start at 0: every time the payload carries is in the same
    // source seconds the caller asked in, not relative to the slice.
    let envelope = session
        .dispatch(
            "run_analysis",
            json!({
                "tool": "spectralCentroid",
                "transient": true,
                "start": 0.4,
                "end": 0.9,
                "includeData": true,
            }),
        )
        .unwrap();
    let result = &envelope["result"];
    assert_eq!(result["windowStart"], 0.4);
    let first = result["times"][0].as_f64().unwrap();
    assert!(
        (first - 0.4).abs() < 1e-3,
        "the first frame should sit at the window start, got {first}"
    );

    // A tool with no time axis still records the origin it ran at.
    let envelope = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "waveform", "transient": true, "start": 0.4, "end": 0.9 }),
        )
        .unwrap();
    assert_eq!(envelope["result"]["windowStart"], 0.4);

    // Note segments are re-based too: their spans and gaps are source seconds.
    let metrics = session
        .dispatch(
            "run_analysis",
            json!({
                "tool": "noteMetrics",
                "transient": true,
                "start": 0.4,
                "end": 0.9,
                "includeData": true,
            }),
        )
        .unwrap();
    let result = &metrics["result"];
    assert_eq!(result["windowStart"], 0.4);
    let first = result["notes"][0]["startSecs"].as_f64().unwrap();
    let last = result["notes"][0]["endSecs"].as_f64().unwrap();
    assert!((first - 0.4).abs() < 0.01, "first note starts at {first}");
    assert!((last - 0.9).abs() < 0.01, "last note ends at {last}");
}
