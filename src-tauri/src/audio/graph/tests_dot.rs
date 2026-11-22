//! DOT interchange tests: round-trip, keyed params, ports and errors (M39).

use super::nodes;
use super::{dot, GraphEdge, GraphError, GraphNode, GraphSpec};

fn empty_spec(kind: &str) -> GraphSpec {
    GraphSpec {
        nodes: vec![GraphNode {
            id: "n".to_string(),
            kind: kind.to_string(),
            params: Vec::new(),
            subgraph: None,
        }],
        edges: Vec::new(),
    }
}

#[test]
fn every_kind_round_trips_through_dot() {
    for def in nodes::all() {
        let spec = empty_spec(def.kind);
        let text = dot::emit(&spec).unwrap_or_else(|err| panic!("{}: {err}", def.kind));
        let parsed = dot::parse(&text).unwrap_or_else(|err| panic!("{}: {err}\n{text}", def.kind));
        assert_eq!(parsed.nodes.len(), 1, "{}", def.kind);
        assert_eq!(parsed.nodes[0].kind, def.kind);
        assert_eq!(
            parsed.nodes[0].params,
            def.params
                .iter()
                .map(|param| param.default)
                .collect::<Vec<_>>(),
            "{}",
            def.kind
        );
    }
}

#[test]
fn a_multi_port_graph_round_trips() {
    let spec = GraphSpec {
        nodes: vec![
            GraphNode {
                id: "in".to_string(),
                kind: "input".to_string(),
                params: vec![],
                subgraph: None,
            },
            GraphNode {
                id: "lp".to_string(),
                kind: "lowpass_cv".to_string(),
                params: vec![],
                subgraph: None,
            },
            GraphNode {
                id: "out".to_string(),
                kind: "output".to_string(),
                params: vec![],
                subgraph: None,
            },
        ],
        edges: vec![
            GraphEdge {
                from: "in".to_string(),
                from_port: 0,
                to: "lp".to_string(),
                to_port: 0,
            },
            GraphEdge {
                from: "lp".to_string(),
                from_port: 0,
                to: "out".to_string(),
                to_port: 0,
            },
        ],
    };
    let text = dot::emit(&spec).unwrap();
    assert!(text.contains("lp [kind=\"lowpass_cv\""));
    assert!(text.contains("label=\"<audio> audio | <cut> cut | <Q> Q | <out> out\""));
    assert!(text.contains("in -> lp:audio"));
    let parsed = dot::parse(&text).unwrap();
    assert_eq!(parsed.edges[0].to_port, 0);
    assert_eq!(parsed.edges[1].from_port, 0);
    assert_eq!(dot::emit(&parsed).unwrap(), text);
}

#[test]
fn the_documented_shapes_parse() {
    let simple = r#"
        digraph {
            node [shape=record];
            in  [kind="input"];
            lp  [kind="lowpass", freq=1000, q=1.0];
            out [kind="output"];
            in:out -> lp:in;
            lp:out -> out:in;
        }
    "#;
    let spec = dot::parse(simple).unwrap();
    assert_eq!(spec.nodes[1].params, vec![1_000.0, 1.0]);
    assert_eq!(spec.edges[0].to_port, 0);

    // A record node names its ports; an edge writes the one it touches.
    let record = r#"
        digraph {
            in  [kind="input"];
            fx  [kind="lowpass_cv",
                 label="<audio> audio | <cut> cut | <Q> Q | <out> out"];
            out [kind="output"];
            in:out -> fx:audio;
            fx:out -> out:in;
        }
    "#;
    let spec = dot::parse(record).unwrap();
    assert_eq!(spec.edges[0].to, "fx");
    assert_eq!(spec.edges[0].to_port, 0);
}

#[test]
fn keyed_params_must_exist_and_be_in_range() {
    let unknown = r#"digraph { n [kind="lowpass", nope=1]; }"#;
    assert!(matches!(
        dot::parse(unknown).unwrap_err(),
        GraphError::UnknownParam(_)
    ));

    let range = r#"digraph { n [kind="lowpass", q=500]; }"#;
    assert!(matches!(
        dot::parse(range).unwrap_err(),
        GraphError::ParamOutOfRange(_)
    ));

    let bad = r#"digraph { n [kind="lowpass", q="wide"]; }"#;
    assert!(matches!(
        dot::parse(bad).unwrap_err(),
        GraphError::BadParamValue(_)
    ));

    let missing_kind = r#"digraph { n [q=1]; }"#;
    assert!(matches!(
        dot::parse(missing_kind).unwrap_err(),
        GraphError::MissingKind(_)
    ));
}

#[test]
fn ports_must_be_named_on_multi_port_nodes() {
    let text = r#"digraph { a [kind="sine"]; b [kind="lowpass_cv", label="<audio> audio | <cut> cut | <Q> Q | <out> out"]; a -> b; }"#;
    assert!(matches!(
        dot::parse(text).unwrap_err(),
        GraphError::MissingPort(_)
    ));

    let unknown = r#"digraph { a [kind="sine"]; b [kind="lowpass_cv", label="<audio> audio | <cut> cut | <Q> Q | <out> out"]; a -> b:zzz; }"#;
    let err = dot::parse(unknown).unwrap_err();
    assert!(matches!(err, GraphError::UnknownPort(_)));

    let bad_label = r#"digraph { b [kind="lowpass_cv", label="<audio> audio"]; }"#;
    assert!(matches!(
        dot::parse(bad_label).unwrap_err(),
        GraphError::BadLabel(_)
    ));
}

#[test]
fn graph_errors_stay_reachable_from_dot() {
    // A cycle still reaches `GraphError::Cycle` through the compiler.
    let cyclic = r#"
        digraph {
            a [kind="lowpass"]; b [kind="lowpass"]; o [kind="output"];
            a:out -> b:in; b:out -> a:in; b:out -> o:in;
        }
    "#;
    let spec = dot::parse(cyclic).unwrap();
    assert!(matches!(
        super::build(&spec, 0, 48_000).map(|_| ()).unwrap_err(),
        GraphError::Cycle
    ));

    // Two edges into one input still reach `InputConflict`.
    let duplicate = r#"
        digraph {
            a [kind="sine"]; b [kind="sine"]; o [kind="output"];
            a:out -> o:in; b:out -> o:in;
        }
    "#;
    let spec = dot::parse(duplicate).unwrap();
    assert!(matches!(
        super::build(&spec, 0, 48_000).map(|_| ()).unwrap_err(),
        GraphError::InputConflict(_)
    ));
}

#[test]
fn files_and_legacy_json_are_accepted() {
    let dir = std::env::temp_dir();
    let dot_path = dir.join(format!("heyl-dot-{}.dot", std::process::id()));
    std::fs::write(&dot_path, r#"digraph { n [kind="sine", freq=220]; }"#).unwrap();
    let parsed = dot::parse_input(dot_path.to_str().unwrap()).unwrap();
    assert_eq!(parsed.nodes[0].params, vec![220.0]);

    let json_path = dir.join(format!("heyl-json-{}.json", std::process::id()));
    std::fs::write(
        &json_path,
        r#"{"nodes":[{"id":"n","kind":"sine","params":[110]}],"edges":[]}"#,
    )
    .unwrap();
    let parsed = dot::parse_input(json_path.to_str().unwrap()).unwrap();
    assert_eq!(parsed.nodes[0].params, vec![110.0]);

    let _ = std::fs::remove_file(dot_path);
    let _ = std::fs::remove_file(json_path);
}

#[test]
fn every_node_skeleton_parses() {
    for def in nodes::all() {
        let skeleton = nodes::dot_skeleton(def);
        let parsed = dot::parse(&format!("digraph {{ {skeleton} }}"))
            .unwrap_or_else(|err| panic!("{}: {err}\n{skeleton}", def.kind));
        assert_eq!(parsed.nodes[0].kind, def.kind);
    }
}

#[test]
fn a_nested_spec_survives_postcard() {
    // The project file stores the source graph with `postcard` (M40 bumped the format to
    // 7 for this field), so the nested spec must round-trip through it.
    use super::tests::{edge, node};

    let mut feedback = node("fb", "feedback", &[]);
    feedback.subgraph = Some(Box::new(GraphSpec {
        nodes: vec![node("in", "input", &[]), node("out", "output", &[])],
        edges: vec![edge("in", "out")],
    }));
    let spec = GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            feedback,
            node("out", "output", &[]),
        ],
        edges: vec![edge("in", "fb"), edge("fb", "out")],
    };
    let bytes = postcard::to_stdvec(&spec).expect("encode");
    let back: GraphSpec = postcard::from_bytes(&bytes).expect("decode");
    let nested = back.nodes[1].subgraph.as_deref().expect("nested graph");
    assert_eq!(nested.nodes.len(), 2);
    assert_eq!(nested.edges.len(), 1);
    assert!(back.nodes[0].subgraph.is_none());
}

#[test]
fn duplicate_nodes_are_rejected() {
    let text = r#"digraph { a [kind="sine"]; a [kind="sine"]; }"#;
    assert!(matches!(
        dot::parse(text).unwrap_err(),
        GraphError::DuplicateNode(_)
    ));
}

#[test]
fn a_subsystem_round_trips_as_a_nested_subgraph() {
    use super::tests::{edge, node};

    let mut feedback = node("fb", "feedback", &[]);
    feedback.subgraph = Some(Box::new(GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            node("lp", "lowpass", &[900.0, 1.2]),
            node("out", "output", &[]),
        ],
        edges: vec![edge("in", "lp"), edge("lp", "out")],
    }));
    let spec = GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            feedback,
            node("out", "output", &[]),
        ],
        edges: vec![edge("in", "fb"), edge("fb", "out")],
    };

    let text = dot::emit(&spec).unwrap();
    assert!(text.contains("system=\"fb.system\""), "{text}");
    assert!(text.contains("subgraph \"fb.system\" {"), "{text}");
    assert!(
        text.contains("lp [kind=\"lowpass\", freq=900, q=1.2];"),
        "{text}"
    );

    let parsed = dot::parse(&text).unwrap();
    let inner = parsed.nodes[1].subgraph.as_deref().expect("nested graph");
    assert_eq!(inner.nodes.len(), 3);
    assert_eq!(inner.edges.len(), 2);
    assert_eq!(inner.nodes[1].params, vec![900.0, 1.2]);
    assert_eq!(dot::emit(&parsed).unwrap(), text);
}

#[test]
fn subsystem_blocks_must_match_their_node() {
    // A block belongs only to a subsystem kind.
    let wrong_kind =
        r#"digraph { n [kind="lowpass", system="x"]; subgraph "x" { o [kind="output"]; } }"#;
    assert!(matches!(
        dot::parse(wrong_kind).unwrap_err(),
        GraphError::UnexpectedSubsystem(_)
    ));

    // A subsystem node naming a block that does not exist.
    let dangling = r#"digraph { n [kind="feedback", system="x"]; }"#;
    assert!(matches!(
        dot::parse(dangling).unwrap_err(),
        GraphError::UnknownSubsystem(_)
    ));

    // A block no node names.
    let orphan = r#"digraph { n [kind="sine"]; subgraph "x" { o [kind="output"]; } }"#;
    assert!(matches!(
        dot::parse(orphan).unwrap_err(),
        GraphError::UnknownSubsystem(_)
    ));
}
