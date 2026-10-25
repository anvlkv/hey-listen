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
