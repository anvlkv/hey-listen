//! `nodes` mapping and DOT graph input (M39).

use super::*;

#[test]
fn nodes_maps_the_kind_and_json_flag() {
    let request = build_request("nodes", &matches(&[])).unwrap();
    assert!(matches!(
        request.command,
        Command::Nodes {
            id: None,
            json: false
        }
    ));

    let request = build_request(
        "nodes",
        &matches(&[("id", json!("lowpass_cv")), ("json", json!(true))]),
    )
    .unwrap();
    match request.command {
        Command::Nodes { id, json } => {
            assert_eq!(id.as_deref(), Some("lowpass_cv"));
            assert!(json);
        }
        _ => panic!("expected a nodes command"),
    }
}

#[test]
fn synth_accepts_dot_text_and_a_dot_file() {
    let dot = r#"digraph { osc [kind="sine", freq=220]; out [kind="output"]; osc:out -> out:in; }"#;
    let request = build_request("synth", &matches(&[("graph", json!(dot))])).unwrap();
    match request.command {
        Command::Synth { graph, .. } => assert_eq!(graph.nodes[0].params, vec![220.0]),
        _ => panic!("expected a synth command"),
    }

    let path = std::env::temp_dir().join("hey_listen_cli_synth_graph.dot");
    std::fs::write(&path, dot).unwrap();
    let request = build_request(
        "synth",
        &matches(&[("graph", json!(path.to_string_lossy().into_owned()))]),
    )
    .unwrap();
    match request.command {
        Command::Synth { graph, .. } => assert_eq!(graph.nodes[0].params, vec![220.0]),
        _ => panic!("expected a synth command"),
    }
    let _ = std::fs::remove_file(&path);
}
