//! DOT at the MCP boundary and the node catalog (M39).

use serde_json::json;

use super::HeadlessSession;

const GAIN_FILTER: &str = r#"
    digraph {
        in  [kind="input"];
        g   [kind="gain", gain=0.5];
        out [kind="output"];
        in:out -> g:in;
        g:out -> out:in;
    }
"#;

#[test]
fn the_node_catalog_is_discoverable() {
    let mut session = HeadlessSession::default();
    let nodes = session.dispatch("list_nodes", json!({})).unwrap();
    let nodes = nodes.as_array().expect("an array");
    assert!(nodes.iter().any(|node| node["kind"] == "lowpass_cv"));
    assert!(nodes
        .iter()
        .all(|node| node["inputPorts"].is_array() && node["params"].is_array()));

    let detail = session
        .dispatch("get_node", json!({ "kind": "lowpass_cv" }))
        .unwrap();
    assert_eq!(detail["node"]["kind"], "lowpass_cv");
    // The record-label contract: the exact port order a hand-authored `label=` must use.
    assert_eq!(
        detail["node"]["recordPorts"],
        json!(["audio", "cut", "Q", "out"])
    );
    assert_eq!(
        detail["node"]["labelTemplate"],
        "<audio> audio | <cut> cut | <Q> Q | <out> out"
    );
    let dot = detail["dot"].as_str().expect("a DOT skeleton");
    assert!(dot.contains("kind=\"lowpass_cv\""));
    assert!(dot.contains("label=\"<audio> audio | <cut> cut | <Q> Q | <out> out\""));

    let err = session
        .dispatch("get_node", json!({ "kind": "nope" }))
        .unwrap_err();
    assert!(err.contains("unknown node kind"));
}

#[test]
fn dot_installs_and_reads_back_a_filter() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "set_filter_graph",
            json!({ "graph": GAIN_FILTER, "enabled": true }),
        )
        .unwrap();
    assert_eq!(
        session.dispatch("get_state", json!({})).unwrap()["filter"]["enabled"],
        true
    );

    let read = session
        .dispatch("get_graph", json!({ "graph": "filter" }))
        .unwrap();
    assert_eq!(read["graph"], "filter");
    let dot = read["dot"].as_str().expect("DOT");
    assert!(dot.contains("kind=\"gain\""));
    assert_eq!(read["spec"]["nodes"][1]["params"], json!([0.5]));
}

#[test]
fn dot_renders_a_synth() {
    let mut session = HeadlessSession::default();
    let dot = r#"digraph { osc [kind="sine", freq=440]; out [kind="output"]; osc:out -> out:in; }"#;
    let summary = session
        .dispatch("render_synth", json!({ "graph": dot, "seconds": 0.25 }))
        .unwrap();
    assert_eq!(summary["sampleRate"], 48_000);
    assert!(summary["frames"].as_u64().unwrap() > 0);

    let read = session
        .dispatch("get_graph", json!({ "graph": "synth" }))
        .unwrap();
    assert!(read["dot"].as_str().unwrap().contains("kind=\"sine\""));
}

#[test]
fn a_graph_file_is_accepted() {
    let dir = std::env::temp_dir();
    let path = dir.join(format!("heyl-mcp-graph-{}.dot", std::process::id()));
    std::fs::write(&path, GAIN_FILTER).unwrap();

    let mut session = HeadlessSession::default();
    let applied = session
        .dispatch(
            "set_filter_graph",
            json!({ "graphFile": path.to_str().unwrap(), "enabled": true }),
        )
        .unwrap();
    assert_eq!(applied["filter"]["enabled"], true);

    let _ = std::fs::remove_file(path);
}

#[test]
fn an_invalid_dot_graph_is_reported() {
    let mut session = HeadlessSession::default();
    let err = session
        .dispatch(
            "set_filter_graph",
            json!({ "graph": r#"digraph { in [kind="input"]; }"# }),
        )
        .unwrap_err();
    assert!(err.contains("output"), "{err}");
}

#[test]
fn legacy_json_is_still_accepted() {
    let mut session = HeadlessSession::default();
    let applied = session
        .dispatch(
            "set_filter_graph",
            json!({ "graph": super::gain_filter_value() }),
        )
        .unwrap();
    assert_eq!(applied["filter"]["enabled"], true);
}
