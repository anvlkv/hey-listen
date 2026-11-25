//! `run_analysis { channels }` — a sweep runs once per output channel.

use serde_json::json;

use super::*;

#[test]
fn a_channels_sweep_runs_once_per_channel_and_leaves_the_session_alone() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 0.5 }),
        )
        .unwrap();

    let out = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "levels", "channels": [0, 1], "summaryOnly": true }),
        )
        .unwrap();
    let entries = out["channels"].as_array().unwrap();
    assert_eq!(out["tool"], "levels");
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["channel"], 0);
    assert_eq!(entries[1]["channel"], 1);
    assert!(entries[0]["summary"]["text"].is_string());
    assert_eq!(entries[0]["params"]["channel"], 0);

    // The sweep is transient: it never writes a channel back to the session.
    let state = session.dispatch("get_state", json!({})).unwrap();
    assert!(state["params"]["channel"].is_null());

    // One channel is not a sweep.
    assert!(session
        .dispatch("run_analysis", json!({ "tool": "levels", "channels": [0] }))
        .unwrap_err()
        .contains("at least two"));
}
