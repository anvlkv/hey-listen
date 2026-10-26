//! `run_analysis` envelope modes and analyzer discovery (M21).

use serde_json::json;

use super::*;

#[test]
fn get_analyzer_reports_options_and_summary_keys() {
    let mut session = HeadlessSession::default();
    let detail = session
        .dispatch("get_analyzer", json!({ "id": "modulation" }))
        .unwrap();
    assert_eq!(detail["id"], "modulation");
    assert!(detail["about"]
        .as_str()
        .is_some_and(|about| !about.is_empty()));
    // Eleven engine options, each with its full metadata.
    assert_eq!(detail["options"].as_array().unwrap().len(), 11);
    assert_eq!(detail["options"][5]["label"], "Pitch frame");
    assert_eq!(detail["options"][5]["unit"], "ms");
    assert_eq!(detail["options"][5]["step"], 1.0);
    assert!(detail["summaryKeys"]
        .as_array()
        .is_some_and(|keys| keys.iter().any(|key| key == "amRateHz")));

    let error = session
        .dispatch("get_analyzer", json!({ "id": "nope" }))
        .unwrap_err();
    assert!(error.contains("unknown analyzer"), "{error}");
}

#[test]
fn get_state_reports_option_defaults() {
    let mut session = HeadlessSession::default();
    let state = session.dispatch("get_state", json!({})).unwrap();
    assert_eq!(state["toolOptions"]["frameRms"]["frameMs"], 10.0);
    assert_eq!(state["toolOptions"]["noteMetrics"]["gateDb"], 35.0);
    assert!(state["toolOptions"]["spectrum"]
        .as_object()
        .is_some_and(|options| options.is_empty()));
}

#[test]
fn run_analysis_modes_summary_compact_and_full() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 1.0 }),
        )
        .unwrap();

    let compact = session
        .dispatch("run_analysis", json!({ "tool": "spectrum" }))
        .unwrap();
    assert_eq!(compact["summary"]["tool"], "spectrum");
    assert!(compact["summary"]["text"]
        .as_str()
        .is_some_and(|text| !text.is_empty()));
    assert!(compact["result"]["magDb"].get("min").is_some());

    // Summary-only drops the result but keeps an identical summary.
    let summary = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "spectrum", "summaryOnly": true }),
        )
        .unwrap();
    assert!(summary.get("result").is_none());
    assert_eq!(summary["summary"], compact["summary"]);

    // Full data (optionally decimated) returns arrays.
    let full = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "spectrum", "includeData": true, "maxPoints": 8 }),
        )
        .unwrap();
    assert!(full["result"]["magDb"]
        .as_array()
        .is_some_and(|values| !values.is_empty() && values.len() <= 8));

    let error = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "spectrum", "summaryOnly": true, "includeData": true }),
        )
        .unwrap_err();
    assert!(error.contains("mutually exclusive"), "{error}");
}

#[test]
fn run_analysis_reports_effective_options_without_nulls() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 0.5 }),
        )
        .unwrap();

    // Only the tool's own options, defaults included — not every key in the struct.
    let frame = session
        .dispatch("run_analysis", json!({ "tool": "frameRms" }))
        .unwrap();
    let options = frame["options"].as_object().unwrap();
    assert_eq!(options.len(), 4);
    assert_eq!(options["frameMs"], 10.0);
    assert_eq!(options["hopMs"], 5.0);
    assert_eq!(options["gateDb"], 0.0);
    assert_eq!(options["gateFloorDb"], -120.0);

    // A set option overrides the default; a transient one is echoed but not stored.
    let yin = session
        .dispatch(
            "run_analysis",
            json!({
                "tool": "pitchYin",
                "options": { "yinThreshold": 0.3 },
                "transient": true,
            }),
        )
        .unwrap();
    let echoed = yin["options"].as_object().unwrap();
    assert!((echoed["yinThreshold"].as_f64().unwrap() - 0.3).abs() < 1e-6);
    assert_eq!(echoed["minF0Hz"], 50.0);
    assert!(!echoed.contains_key("frameMs"));
    let state = session.dispatch("get_state", json!({})).unwrap();
    assert_eq!(state["toolOptions"]["pitchYin"]["yinThreshold"], 0.12);
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
                    "syllable_gap_ms": 50,
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
    assert_eq!(metrics["options"]["syllableGapMs"], 50.0);
    // The opt-in grouping travels with the result (one continuous tone = one syllable).
    assert_eq!(metrics["result"]["syllables"][0]["noteCount"], 1);
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
fn a_gated_series_reports_its_gate_through_the_session() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 0.5 }),
        )
        .unwrap();
    let envelope = session
        .dispatch(
            "run_analysis",
            json!({
                "tool": "frameRms",
                "options": { "gateDb": 20 },
                "includeData": true,
            }),
        )
        .unwrap();
    assert_eq!(envelope["options"]["gateDb"], 20.0);
    let gate = &envelope["result"]["gate"];
    assert_eq!(gate["gateDb"], 20.0);
    assert_eq!(gate["gateFloorDb"], -120.0);
    assert!(gate["thresholdDb"].as_f64().is_some());
    // The summary echoes the effective gate beside the measurement.
    let keys: Vec<&str> = envelope["summary"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["key"].as_str())
        .collect();
    assert!(keys.contains(&"gateThresholdDb"), "keys: {keys:?}");
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
