//! Unit tests for the extra shaping, delay-as-signal and envelope/gate node
//! families (D-17). Kept apart from `tests.rs` so each file stays small.

use super::tests::{edge, edge_to, node};
use super::*;

/// A synth graph with one generator feeding a 1-in/1-out node.
fn through(kind: &str, params: &[f32]) -> GraphSpec {
    GraphSpec {
        nodes: vec![
            node("osc", "sine", &[220.0]),
            node("n", kind, params),
            node("out", "output", &[]),
        ],
        edges: vec![edge("osc", "n"), edge("n", "out")],
    }
}

/// A synth graph whose node also takes a control signal on input 1.
fn with_control(kind: &str, params: &[f32], control: f32) -> GraphSpec {
    GraphSpec {
        nodes: vec![
            node("osc", "sine", &[220.0]),
            node("ctl", "dc", &[control]),
            node("n", kind, params),
            node("out", "output", &[]),
        ],
        edges: vec![
            edge_to("osc", 0, "n", 0),
            edge_to("ctl", 0, "n", 1),
            edge("n", "out"),
        ],
    }
}

/// Render `frames` at 48 kHz and assert the buffer is finite and carries signal.
fn assert_audible(spec: &GraphSpec, kind: &str, frames: usize) {
    let out = render_mono(spec, frames as f64 / 48_000.0, 48_000)
        .unwrap_or_else(|error| panic!("{kind}: {error}"));
    assert_eq!(out.len(), frames, "{kind}");
    assert!(
        out.iter().all(|s| s.is_finite()),
        "{kind}: non-finite output"
    );
    let energy: f32 = out.iter().map(|s| s.abs()).sum();
    assert!(energy > 0.0, "{kind}: produced silence");
}

#[test]
fn new_kinds_report_their_arities() {
    for (kind, arity) in [
        ("zero", (0, 1)),
        ("impulse", (0, 1)),
        ("clip_to", (1, 1)),
        ("declick", (1, 1)),
        ("dcblock_hz", (1, 1)),
        ("follow", (1, 1)),
        ("afollow", (1, 1)),
        ("hold", (2, 1)),
        ("tap", (2, 1)),
    ] {
        assert_eq!(kind_arity(kind), Some(arity), "{kind}");
    }
}

#[test]
fn shaping_and_envelope_processors_render_sound() {
    for (kind, params) in [
        ("clip_to", vec![-1.0, 1.0]),
        ("declick", vec![0.01]),
        ("dcblock_hz", vec![5.0]),
        ("follow", vec![0.05]),
        ("afollow", vec![0.01, 0.1]),
    ] {
        assert_audible(&through(kind, &params), kind, 2_400);
    }
}

#[test]
fn generators_zero_and_impulse_compile() {
    let zero_spec = GraphSpec {
        nodes: vec![node("z", "zero", &[]), node("out", "output", &[])],
        edges: vec![edge("z", "out")],
    };
    let silent = render_mono(&zero_spec, 0.01, 48_000).expect("zero");
    assert_eq!(silent.len(), 480);
    assert!(silent.iter().all(|s| s.abs() < 1e-9), "zero is not silent");

    let impulse_spec = GraphSpec {
        nodes: vec![node("i", "impulse", &[]), node("out", "output", &[])],
        edges: vec![edge("i", "out")],
    };
    let out = render_mono(&impulse_spec, 0.01, 48_000).expect("impulse");
    assert_eq!(out[0], 1.0, "first sample is not the impulse");
    assert!(out[1..].iter().all(|s| s.abs() < 1e-9), "impulse rings on");
}

#[test]
fn hold_and_tap_take_a_second_input() {
    // `hold`: input 1 is the trigger signal (the hold rate in Hz). A constant audio
    // input keeps the held value independent of when the trigger happens.
    let held = GraphSpec {
        nodes: vec![
            node("sig", "dc", &[0.5]),
            node("rate", "dc", &[20.0]),
            node("h", "hold", &[0.1]),
            node("out", "output", &[]),
        ],
        edges: vec![
            edge_to("sig", 0, "h", 0),
            edge_to("rate", 0, "h", 1),
            edge("h", "out"),
        ],
    };
    assert_audible(&held, "hold", 4_800);

    // `tap`: input 1 is the delay time in seconds.
    assert_audible(&with_control("tap", &[0.0, 0.05], 0.01), "tap", 4_800);
}
