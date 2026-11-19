//! "Did you mean?" hints for a misspelled analyzer, tool, or option key (D-10).
//!
//! The prefix of each error stays exactly as before (callers and tests match on it); a
//! near miss just gains a `(did you mean …?)` suffix.

use serde_json::json;

use super::*;

#[test]
fn a_misspelled_analyzer_suggests_the_nearest_id() {
    let mut session = HeadlessSession::default();
    let error = session
        .dispatch("get_analyzer", json!({ "id": "specturm" }))
        .unwrap_err();
    assert!(error.contains("unknown analyzer: specturm"), "{error}");
    assert!(error.contains("(did you mean spectrum?)"), "{error}");
}

#[test]
fn a_misspelled_tool_suggests_the_nearest_id() {
    let mut session = HeadlessSession::default();
    let error = session
        .dispatch("open_tool", json!({ "tool": "wavefrom" }))
        .unwrap_err();
    assert!(error.contains("unknown tool: wavefrom"), "{error}");
    assert!(error.contains("(did you mean waveform?)"), "{error}");
}

#[test]
fn a_misspelled_option_suggests_the_nearest_key() {
    let mut session = HeadlessSession::default();
    let error = session
        .dispatch(
            "set_tool_options",
            json!({ "tool": "pitchYin", "options": { "minF0Hx": 50 } }),
        )
        .unwrap_err();
    assert!(
        error.contains("unknown option for pitchYin: minF0Hx"),
        "{error}"
    );
    assert!(error.contains("(did you mean minF0Hz?)"), "{error}");
}

#[test]
fn a_valid_id_and_option_are_unaffected() {
    let mut session = HeadlessSession::default();
    let detail = session
        .dispatch("get_analyzer", json!({ "id": "spectrum" }))
        .unwrap();
    assert_eq!(detail["id"], "spectrum");
    let applied = session
        .dispatch(
            "set_tool_options",
            json!({ "tool": "pitchYin", "options": { "minF0Hz": 60 } }),
        )
        .unwrap();
    assert_eq!(applied["options"]["minF0Hz"], 60.0);
}
