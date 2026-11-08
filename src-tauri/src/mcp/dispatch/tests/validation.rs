//! Override validation (audit P2 #10): a headless call must reject a wrong-typed shared
//! param, an option that does not belong to the tool, and an out-of-range value instead
//! of silently ignoring it or reporting a setting the engine will not honour.

use serde_json::json;

use super::*;

#[test]
fn a_wrong_typed_shared_param_is_an_error() {
    let mut session = HeadlessSession::default();
    let error = session
        .dispatch(
            "set_shared_params",
            json!({ "params": { "fftSize": "4096" } }),
        )
        .unwrap_err();
    assert!(error.contains("fftSize"), "{error}");
    // The rejected patch left the stored params untouched.
    assert_eq!(
        session.dispatch("get_state", json!({})).unwrap()["params"]["fftSize"],
        2048.0
    );
}

#[test]
fn an_out_of_range_shared_param_is_an_error() {
    let mut session = HeadlessSession::default();
    for (key, value) in [
        ("hop", json!(0.0)),
        ("fftSize", json!(8)),
        ("freqMinHz", json!(-5)),
    ] {
        let error = session
            .dispatch("set_shared_params", json!({ "params": { key: value } }))
            .unwrap_err();
        assert!(error.contains(key), "{key}: {error}");
    }
}

#[test]
fn an_option_that_does_not_belong_to_the_tool_is_rejected() {
    let mut session = HeadlessSession::default();
    // `nMels` is an MFCC/spectrogram option, not a frameRms one.
    let error = session
        .dispatch(
            "set_tool_options",
            json!({ "tool": "frameRms", "options": { "nMels": 20 } }),
        )
        .unwrap_err();
    assert!(
        error.contains("nMels") && error.contains("frameRms"),
        "{error}"
    );
}

#[test]
fn an_out_of_range_option_is_rejected() {
    let mut session = HeadlessSession::default();
    // frameRms declares frameMs in 0.1..1000 ms.
    let error = session
        .dispatch(
            "set_tool_options",
            json!({ "tool": "frameRms", "options": { "frameMs": 0 } }),
        )
        .unwrap_err();
    assert!(
        error.contains("frameMs") && error.contains("0.1"),
        "{error}"
    );
}

#[test]
fn run_analysis_rejects_a_bad_option_override() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": { "nodes": [], "edges": [] }, "seconds": 0.1 }),
        )
        .ok();
    let error = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "frameRms", "options": { "minF0Hz": 50 } }),
        )
        .unwrap_err();
    assert!(error.contains("minF0Hz"), "{error}");
}

#[test]
fn a_valid_override_still_applies() {
    let mut session = HeadlessSession::default();
    let value = session
        .dispatch(
            "set_tool_options",
            json!({ "tool": "frameRms", "options": { "frameMs": 20, "hopMs": 10 } }),
        )
        .expect("valid overrides");
    assert_eq!(value["options"]["frameMs"], 20.0);
    assert_eq!(value["options"]["hopMs"], 10.0);
}
