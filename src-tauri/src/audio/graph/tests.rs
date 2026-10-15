//! Unit tests for the graph engine (split out of `mod.rs`).

use super::*;

fn node(id: &str, kind: &str, params: &[f32]) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        kind: kind.to_string(),
        params: params.to_vec(),
    }
}

fn edge(from: &str, to: &str) -> GraphEdge {
    GraphEdge {
        from: from.to_string(),
        from_port: 0,
        to: to.to_string(),
        to_port: 0,
    }
}

fn edge_to(from: &str, from_port: usize, to: &str, to_port: usize) -> GraphEdge {
    GraphEdge {
        from: from.to_string(),
        from_port,
        to: to.to_string(),
        to_port,
    }
}

#[test]
fn gain_filter_scales_the_signal() {
    let spec = GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            node("g", "gain", &[0.5]),
            node("out", "output", &[]),
        ],
        edges: vec![edge("in", "g"), edge("g", "out")],
    };
    let output = apply_mono(&spec, &vec![1.0f32; 128], 48_000).expect("apply");
    assert_eq!(output.len(), 128);
    for value in output {
        assert!((value - 0.5).abs() < 1e-6, "got {value}");
    }
}

#[test]
fn lowpass_passes_dc_and_attenuates_high_frequency() {
    let spec = GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            node("lp", "lowpass", &[1_000.0, 0.707]),
            node("out", "output", &[]),
        ],
        edges: vec![edge("in", "lp"), edge("lp", "out")],
    };
    let out = apply_mono(&spec, &vec![1.0f32; 4_000], 48_000).unwrap();
    assert!(
        (out[out.len() - 1] - 1.0).abs() < 0.05,
        "dc = {}",
        out[out.len() - 1]
    );

    let nyquist: Vec<f32> = (0..4_000)
        .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
        .collect();
    let out = apply_mono(&spec, &nyquist, 48_000).unwrap();
    let peak = out.iter().skip(200).fold(0f32, |acc, s| acc.max(s.abs()));
    assert!(peak < 0.1, "high frequency leaked: {peak}");
}

#[test]
fn control_input_lowpass_passes_dc() {
    // `lowpass_cv` takes (audio, cutoff, Q): a control-driven low-pass.
    let spec = GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            node("cut", "dc", &[1_000.0]),
            node("q", "dc", &[0.707]),
            node("lp", "lowpass_cv", &[]),
            node("out", "output", &[]),
        ],
        edges: vec![
            edge_to("in", 0, "lp", 0),
            edge_to("cut", 0, "lp", 1),
            edge_to("q", 0, "lp", 2),
            edge("lp", "out"),
        ],
    };
    let out = apply_mono(&spec, &vec![1.0f32; 4_000], 48_000).unwrap();
    assert!(
        (out[out.len() - 1] - 1.0).abs() < 0.05,
        "dc = {}",
        out[out.len() - 1]
    );
}

#[test]
fn compressor_reduces_a_loud_signal() {
    let spec = GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            node("comp", "compressor", &[-18.0, 4.0, 0.001, 0.05]),
            node("out", "output", &[]),
        ],
        edges: vec![edge("in", "comp"), edge("comp", "out")],
    };
    let out = apply_mono(&spec, &vec![0.9f32; 4_000], 48_000).unwrap();
    // Skip the attack transient; the compressed steady state should be well below 1.
    let tail = &out[out.len() - 200..];
    let peak = tail.iter().fold(0f32, |acc, s| acc.max(s.abs()));
    assert!(peak < 0.5, "compressor did not reduce the level: {peak}");
}

#[test]
fn unwired_filter_is_not_applied() {
    // The low-pass is not wired to the output, so the output is just the input.
    let spec = GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            node("lp", "lowpass", &[500.0, 0.707]),
            node("out", "output", &[]),
        ],
        edges: vec![edge("in", "out")],
    };
    let out = apply_mono(&spec, &vec![1.0f32; 256], 48_000).unwrap();
    for value in out {
        assert!((value - 1.0).abs() < 1e-6, "got {value}");
    }
}

#[test]
fn missing_input_is_an_error() {
    let spec = GraphSpec {
        nodes: vec![node("out", "output", &[])],
        edges: vec![],
    };
    assert!(matches!(
        build(&spec, 1, 48_000),
        Err(GraphError::MissingInput)
    ));
}

#[test]
fn missing_output_is_an_error() {
    let spec = GraphSpec {
        nodes: vec![node("osc", "sine", &[440.0])],
        edges: vec![],
    };
    assert!(matches!(build(&spec, 0, 48_000), Err(GraphError::NoOutput)));
}

#[test]
fn synth_renders_a_sine() {
    let spec = GraphSpec {
        nodes: vec![node("osc", "sine", &[440.0]), node("out", "output", &[])],
        edges: vec![edge("osc", "out")],
    };
    let samples = render_mono(&spec, 0.05, 48_000).unwrap();
    assert_eq!(samples.len(), 2_400);
    let peak = samples.iter().fold(0f32, |acc, s| acc.max(s.abs()));
    assert!(peak > 0.9, "expected a full-scale sine, peak = {peak}");
}

#[test]
fn mix_sums_two_generators() {
    let spec = GraphSpec {
        nodes: vec![
            node("a", "dc", &[0.25]),
            node("b", "dc", &[0.5]),
            node("mix", "mix", &[]),
            node("out", "output", &[]),
        ],
        edges: vec![
            edge_to("a", 0, "mix", 0),
            edge_to("b", 0, "mix", 1),
            edge("mix", "out"),
        ],
    };
    for value in render_mono(&spec, 0.001, 48_000).unwrap() {
        assert!((value - 0.75).abs() < 1e-6, "got {value}");
    }
}

#[test]
fn math_nodes_apply_their_operations() {
    // A binary math node fed by the constants 2 and 3 (A and B).
    let binary = |kind: &str| GraphSpec {
        nodes: vec![
            node("a", "dc", &[2.0]),
            node("b", "dc", &[3.0]),
            node("m", kind, &[]),
            node("out", "output", &[]),
        ],
        edges: vec![
            edge_to("a", 0, "m", 0),
            edge_to("b", 0, "m", 1),
            edge("m", "out"),
        ],
    };
    let last = |spec: &GraphSpec| {
        let out = render_mono(spec, 0.001, 48_000).expect("render");
        out[out.len() - 1]
    };
    let close = |value: f32, expected: f32| assert!((value - expected).abs() < 1e-4, "{value}");
    close(last(&binary("add")), 5.0);
    close(last(&binary("subtract")), -1.0);
    close(last(&binary("multiply")), 6.0);
    close(last(&binary("divide")), 2.0 / 3.0);
    close(last(&binary("min")), 2.0);
    close(last(&binary("max")), 3.0);

    // Unary nodes: abs(-2) = 2, invert(-2) = 2.
    let unary = |kind: &str| GraphSpec {
        nodes: vec![
            node("a", "dc", &[-2.0]),
            node("u", kind, &[]),
            node("out", "output", &[]),
        ],
        edges: vec![edge("a", "u"), edge("u", "out")],
    };
    close(last(&unary("abs")), 2.0);
    close(last(&unary("invert")), 2.0);
}

#[test]
fn input_in_synth_graph_is_rejected() {
    let spec = GraphSpec {
        nodes: vec![node("in", "input", &[]), node("out", "output", &[])],
        edges: vec![edge("in", "out")],
    };
    assert!(matches!(
        build(&spec, 0, 48_000),
        Err(GraphError::InputInSynth(_))
    ));
}

#[test]
fn two_edges_into_one_input_are_rejected() {
    let spec = GraphSpec {
        nodes: vec![
            node("a", "dc", &[0.5]),
            node("b", "dc", &[0.5]),
            node("g", "gain", &[1.0]),
            node("out", "output", &[]),
        ],
        edges: vec![edge("a", "g"), edge("b", "g"), edge("g", "out")],
    };
    assert!(matches!(
        build(&spec, 0, 48_000),
        Err(GraphError::InputConflict(_))
    ));
}

#[test]
fn cycles_are_rejected() {
    // Two `mix` nodes feed each other on distinct ports (no input conflict), so
    // this is a genuine cycle: `a` -> `b` -> `a`.
    let spec = GraphSpec {
        nodes: vec![
            node("a", "mix", &[]),
            node("b", "mix", &[]),
            node("out", "output", &[]),
        ],
        edges: vec![edge("a", "b"), edge("b", "a"), edge("a", "out")],
    };
    assert!(matches!(build(&spec, 0, 48_000), Err(GraphError::Cycle)));
}

#[test]
fn split_then_join_is_identity() {
    // `input` -> `split` (1->2) -> `join` (2->1) -> `output`: the two copies of
    // the mono signal average straight back to the input.
    let spec = GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            node("sp", "split", &[]),
            node("jo", "join", &[]),
            node("out", "output", &[]),
        ],
        edges: vec![
            edge_to("in", 0, "sp", 0),
            edge_to("sp", 0, "jo", 0),
            edge_to("sp", 1, "jo", 1),
            edge("jo", "out"),
        ],
    };
    let out = apply_mono(&spec, &vec![0.5f32; 256], 48_000).expect("apply");
    assert_eq!(out.len(), 256);
    for value in out {
        assert!((value - 0.5).abs() < 1e-6, "got {value}");
    }
}

#[test]
fn stereo_reverb_graph_compiles_and_runs() {
    // A stereo node (2 in / 2 out) inside the mono pipeline: the `split`/`join`
    // pair bridges the mono net to the reverb and back.
    let spec = GraphSpec {
        nodes: vec![
            node("osc", "sine", &[220.0]),
            node("sp", "split", &[]),
            node("rv", "reverb_stereo", &[10.0, 2.0, 0.5]),
            node("jo", "join", &[]),
            node("out", "output", &[]),
        ],
        edges: vec![
            edge_to("osc", 0, "sp", 0),
            edge_to("sp", 0, "rv", 0),
            edge_to("sp", 1, "rv", 1),
            edge_to("rv", 0, "jo", 0),
            edge_to("rv", 1, "jo", 1),
            edge("jo", "out"),
        ],
    };
    let out = render_mono(&spec, 0.1, 48_000).expect("render");
    assert_eq!(out.len(), 4_800);
    assert!(
        out.iter().all(|s| s.is_finite()),
        "non-finite reverb output"
    );
    let energy: f32 = out.iter().map(|s| s.abs()).sum();
    assert!(energy > 0.0, "reverb produced silence");
}

#[test]
fn centered_pan_then_join_uses_equal_power() {
    // `pan` widens mono to stereo; `join` averages it back. Center pan is
    // equal-power, so the mono result is ~0.707 of the input.
    let spec = GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            node("p", "pan", &[0.0]),
            node("jo", "join", &[]),
            node("out", "output", &[]),
        ],
        edges: vec![
            edge_to("in", 0, "p", 0),
            edge_to("p", 0, "jo", 0),
            edge_to("p", 1, "jo", 1),
            edge("jo", "out"),
        ],
    };
    let out = apply_mono(&spec, &vec![1.0f32; 256], 48_000).expect("apply");
    let last = out[out.len() - 1];
    assert!((last - 0.707).abs() < 0.05, "centered pan = {last}");
}
