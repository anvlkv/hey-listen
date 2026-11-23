//! Unit tests for multi-channel filter-graph output
//! "Output channels"). Split out of `tests.rs` to stay inside the source-size budget.

use super::tests::{edge, edge_to, node};
use super::*;

/// One input split into two branches, each written to its own `output` channel.
fn two_output_spec() -> GraphSpec {
    GraphSpec {
        nodes: vec![
            node("in", "input", &[]),
            node("half", "gain", &[0.5]),
            node("out0", "output", &[0.0]),
            node("out1", "output", &[1.0]),
        ],
        edges: vec![
            edge("in", "out0"),
            edge_to("in", 0, "half", 0),
            edge("half", "out1"),
        ],
    }
}

#[test]
fn a_filter_graph_outputs_one_channel_per_output_node() {
    let spec = two_output_spec();
    assert_eq!(output_channels(&spec).expect("channels"), 2);

    let first = apply_channel(&spec, &[1.0f32; 64], 48_000, Some(0)).expect("apply");
    let second = apply_channel(&spec, &[1.0f32; 64], 48_000, Some(1)).expect("apply");
    assert!((first[63] - 1.0).abs() < 1e-6, "channel 0 = {}", first[63]);
    assert!(
        (second[63] - 0.5).abs() < 1e-6,
        "channel 1 = {}",
        second[63]
    );

    // The downmix pick (and an index the graph does not have) averages the channels.
    let mix = apply_mono(&spec, &[1.0f32; 64], 48_000).expect("apply");
    assert!((mix[63] - 0.75).abs() < 1e-6, "mix = {}", mix[63]);
    let beyond = apply_channel(&spec, &[1.0f32; 64], 48_000, Some(7)).expect("apply");
    assert!(
        (beyond[63] - 0.75).abs() < 1e-6,
        "out of range = {}",
        beyond[63]
    );
}

#[test]
fn a_filter_graph_renders_every_output_channel_interleaved() {
    let spec = two_output_spec();
    let (pcm, channels) = apply_channels(&spec, &[1.0f32; 64], 48_000).expect("apply");
    assert_eq!(channels, 2);
    assert_eq!(pcm.len(), 128);
    // Channel 0 is the pass-through, channel 1 the gain-0.5 branch, frame by frame.
    for frame in pcm.chunks(2) {
        assert!((frame[0] - 1.0).abs() < 1e-6, "channel 0 = {}", frame[0]);
        assert!((frame[1] - 0.5).abs() < 1e-6, "channel 1 = {}", frame[1]);
    }
}

#[test]
fn an_output_channel_must_be_unique_and_in_range() {
    let mut duplicate = two_output_spec();
    duplicate.nodes[3].params = vec![0.0];
    assert!(matches!(
        output_channels(&duplicate),
        Err(GraphError::DuplicateOutput(0))
    ));
    assert!(matches!(
        apply_mono(&duplicate, &[1.0f32; 8], 48_000),
        Err(GraphError::DuplicateOutput(0))
    ));

    let mut beyond = two_output_spec();
    beyond.nodes[3].params = vec![99.0];
    assert!(matches!(
        output_channels(&beyond),
        Err(GraphError::OutputChannel(99, _))
    ));
}

#[test]
fn a_synth_renders_every_output_channel_interleaved() {
    // Two generators, each on its own output channel (a synth has no global input).
    let spec = GraphSpec {
        nodes: vec![
            node("a", "dc", &[1.0]),
            node("b", "dc", &[0.5]),
            node("out0", "output", &[0.0]),
            node("out1", "output", &[1.0]),
        ],
        edges: vec![edge("a", "out0"), edge("b", "out1")],
    };
    let (pcm, channels) = render_pcm(&spec, 4.0 / 48_000.0, 48_000).expect("render");
    assert_eq!(channels, 2);
    assert_eq!(pcm.len(), 8);
    assert_eq!(pcm, vec![1.0, 0.5, 1.0, 0.5, 1.0, 0.5, 1.0, 0.5]);

    // The mono form averages the channels, so a caller with one lane loses nothing.
    let mono = render_mono(&spec, 4.0 / 48_000.0, 48_000).expect("mono");
    assert_eq!(mono, vec![0.75; 4]);
}

#[test]
fn a_channel_nobody_claims_is_silent() {
    let mut spec = two_output_spec();
    spec.nodes[3].params = vec![2.0];
    assert_eq!(output_channels(&spec).expect("channels"), 3);
    let gap = apply_channel(&spec, &[1.0f32; 32], 48_000, Some(1)).expect("apply");
    assert!(gap.iter().all(|sample| *sample == 0.0), "gap sounded");
    let top = apply_channel(&spec, &[1.0f32; 32], 48_000, Some(2)).expect("apply");
    assert!((top[31] - 0.5).abs() < 1e-6, "channel 2 = {}", top[31]);
}
