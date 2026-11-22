//! Variadic-table tests: a `sequence` node's note table and voice (M41).

use super::{dot, GraphEdge, GraphError, GraphNode, GraphSpec};

#[test]
fn a_sequence_round_trips_with_its_notes_and_voice() {
    let voice = |kind: &str, params: Vec<f32>| GraphNode {
        id: kind.to_string(),
        kind: kind.to_string(),
        params,
        subgraph: None,
    };
    let mut params = vec![4.0]; // loop
    params.extend([0.0, 0.5, 69.0, 0.8, 0.5, 0.5, 72.0, 0.9]);
    let spec = GraphSpec {
        nodes: vec![GraphNode {
            id: "seq".to_string(),
            kind: "sequence".to_string(),
            params: params.clone(),
            subgraph: Some(Box::new(GraphSpec {
                nodes: vec![
                    voice("input", vec![]),
                    voice("saw_cv", vec![]),
                    voice("output", vec![]),
                ],
                edges: vec![
                    GraphEdge {
                        from: "input".to_string(),
                        from_port: 0,
                        to: "saw_cv".to_string(),
                        to_port: 0,
                    },
                    GraphEdge {
                        from: "saw_cv".to_string(),
                        from_port: 0,
                        to: "output".to_string(),
                        to_port: 0,
                    },
                ],
            })),
        }],
        edges: Vec::new(),
    };
    let text = dot::emit(&spec).expect("emit");
    assert!(
        text.contains("notes=\"0,0.5,69,0.8,0.5,0.5,72,0.9\""),
        "{text}"
    );
    assert!(text.contains("subgraph \"seq.system\""), "{text}");

    let parsed = dot::parse(&text).expect("parse");
    assert_eq!(parsed.nodes[0].params, params);
    let voice = parsed.nodes[0]
        .subgraph
        .as_deref()
        .expect("the voice block");
    assert_eq!(voice.nodes.len(), 3);
    assert_eq!(voice.edges.len(), 2);

    // Each column has its own range: a velocity above 1 is rejected even though a
    // "note" of 100 would be fine in the same row.
    let broken = text.replace("0.9\"", "1.9\"");
    assert!(matches!(
        dot::parse(&broken),
        Err(GraphError::ParamOutOfRange(_))
    ));
}

#[test]
fn a_table_value_outside_its_column_range_is_rejected() {
    // Each column validates against its own range: a phase of 2 is out of `Phase`'s
    // 0..1 even though it would be a legal sample value.
    let text = r#"digraph {
        node [shape=record];
        wt  [kind="wave_synth", freq=220, harmonics="1,0,0.5,0"];
        out [kind="output"];
        wt -> out;
    }"#;
    assert!(dot::parse(text).is_ok());
    let broken = text.replace("0.5,0", "0.5,2");
    assert!(matches!(
        dot::parse(&broken),
        Err(GraphError::ParamOutOfRange(_))
    ));
}
