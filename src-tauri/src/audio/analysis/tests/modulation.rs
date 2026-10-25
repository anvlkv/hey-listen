//! Modulation-spectrum tests (M20), driven through the app's **synth graph** facility:
//! every case renders a `GraphSpec` to PCM with `graph::render_mono`, then analyses it.
//!
//! The graphs use the same nodes the synth editor exposes:
//! - **AM** — a `sine` carrier multiplied by one or more `sine_lfo` envelopes.
//! - **FM** — a `sine` carrier through `allpole_cv`, whose delay (in samples) is driven
//!   by a `sine_lfo`; a varying delay is a phase modulation, hence a frequency one.

use super::*;
use crate::audio::graph::{render_mono, GraphEdge, GraphNode, GraphSpec};

/// A lower rate keeps the two YIN passes quick; every modulation rate tested is far
/// below its Nyquist.
const MOD_RATE: u32 = 16_000;

/// Narrow the f0 search so the graph renders are cheap; the sounds sit at 440 Hz.
fn mod_options() -> ToolOptions {
    ToolOptions {
        min_f0_hz: Some(300.0),
        max_f0_hz: Some(700.0),
        ..ToolOptions::default()
    }
}

fn node(id: &str, kind: &str, params: &[f32]) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        kind: kind.to_string(),
        params: params.to_vec(),
    }
}

fn edge(from: &str, from_port: usize, to: &str, to_port: usize) -> GraphEdge {
    GraphEdge {
        from: from.to_string(),
        from_port,
        to: to.to_string(),
        to_port,
    }
}

/// Render a synth graph to PCM at [`MOD_RATE`].
fn render(spec: &GraphSpec, seconds: f32) -> Vec<f32> {
    render_mono(spec, f64::from(seconds), MOD_RATE).expect("render the synth graph")
}

/// `sine(hz)` straight to the output.
fn tone(hz: f32) -> GraphSpec {
    GraphSpec {
        nodes: vec![node("osc", "sine", &[hz]), node("out", "output", &[])],
        edges: vec![edge("osc", 0, "out", 0)],
    }
}

/// `sine(hz) × Π(1 + depth·sin(2π rate t))`: one `sine_lfo`/`multiply` pair per rate.
fn am_tone(hz: f32, rates: &[(f32, f32)]) -> GraphSpec {
    let mut nodes = vec![node("osc", "sine", &[hz])];
    let mut edges = Vec::new();
    let mut last = "osc".to_string();
    for (index, &(rate, depth)) in rates.iter().enumerate() {
        let lfo = format!("lfo{index}");
        let multiply = format!("mult{index}");
        // sine_lfo params: [rate, amount, offset] — `1 + depth·sin(rate·t)`.
        nodes.push(node(&lfo, "sine_lfo", &[rate, depth, 1.0]));
        nodes.push(node(&multiply, "multiply", &[]));
        edges.push(edge(&last, 0, &multiply, 0));
        edges.push(edge(&lfo, 0, &multiply, 1));
        last = multiply;
    }
    nodes.push(node("out", "output", &[]));
    edges.push(edge(&last, 0, "out", 0));
    GraphSpec { nodes, edges }
}

/// An FM carrier: `sine(hz)` through a control-driven all-pass delay. The LFO swings
/// the delay by `depth_samples` around `delay_samples`, so the carrier's phase (and
/// therefore its frequency) wobbles at `rate`.
fn fm_tone(hz: f32, rate: f32, depth_samples: f32, delay_samples: f32) -> GraphSpec {
    GraphSpec {
        nodes: vec![
            node("osc", "sine", &[hz]),
            node("lfo", "sine_lfo", &[rate, depth_samples, delay_samples]),
            node("ap", "allpole_cv", &[]),
            node("out", "output", &[]),
        ],
        edges: vec![
            edge("osc", 0, "ap", 0),
            edge("lfo", 0, "ap", 1),
            edge("ap", 0, "out", 0),
        ],
    }
}

/// A constant zero — a synth graph with no signal.
fn silence() -> GraphSpec {
    GraphSpec {
        nodes: vec![node("dc", "dc", &[0.0]), node("out", "output", &[])],
        edges: vec![edge("dc", 0, "out", 0)],
    }
}

fn run_mod(mono: &[f32], options: &ToolOptions) -> ModulationResult {
    match run("modulation", mono, MOD_RATE, &params(2048), options).expect("modulation") {
        AnalysisResult::Modulation(result) => result,
        other => panic!("unexpected result: {other:?}"),
    }
}

/// Whether an AM peak sits within `tolerance` Hz of `expected`.
fn has_am_peak(result: &ModulationResult, expected: f32, tolerance: f32) -> bool {
    result
        .am_peaks
        .iter()
        .any(|peak| (peak.rate_hz - expected).abs() <= tolerance)
}

#[test]
fn ten_hz_am_renders_from_a_synth_graph() {
    let mono = render(&am_tone(440.0, &[(10.0, 0.5)]), 1.0);
    let result = run_mod(&mono, &mod_options());

    let peak = result.am_peaks.first().expect("an AM peak");
    assert!(
        (peak.rate_hz - 10.0).abs() < 1.5,
        "top AM rate = {} Hz (peaks: {:?})",
        peak.rate_hz,
        result.am_peaks
    );
    assert!(
        peak.relative_db > -6.0,
        "the peak should stand out, relative_db = {}",
        peak.relative_db
    );
    // The graph's envelope is 1 ± 0.5, so (max − min) / (max + min) ≈ 0.5.
    let depth = result.am_depth.expect("an amplitude envelope");
    assert!((depth - 0.5).abs() < 0.1, "am depth = {depth}");
    assert!(result.am_peak_to_trough_db.is_some_and(|db| db > 6.0));
}

#[test]
fn slow_and_fast_am_rates_coexist_in_one_graph() {
    let mono = render(&am_tone(440.0, &[(3.0, 0.4), (40.0, 0.2)]), 2.0);
    let result = run_mod(&mono, &mod_options());

    assert!(result.am_peaks.len() >= 2, "peaks: {:?}", result.am_peaks);
    assert!(
        has_am_peak(&result, 3.0, 1.5),
        "no 3 Hz peak in {:?}",
        result.am_peaks
    );
    assert!(
        has_am_peak(&result, 40.0, 1.5),
        "no 40 Hz peak in {:?}",
        result.am_peaks
    );
}

#[test]
fn a_thirty_hz_fm_sweep_renders_from_a_synth_graph() {
    let mono = render(&fm_tone(440.0, 30.0, 10.0, 20.0), 1.0);
    let result = run_mod(&mono, &mod_options());

    let peak = result.fm_peaks.first().expect("an FM peak");
    assert!(
        (peak.rate_hz - 30.0).abs() < 2.0,
        "top FM rate = {} Hz (peaks: {:?})",
        peak.rate_hz,
        result.fm_peaks
    );
    assert_eq!(result.fm_rate_hz, Some(peak.rate_hz));
    assert!(
        result.fm_run_start_secs.is_some() && result.fm_run_end_secs.is_some(),
        "the analysed run span should be reported"
    );
    assert!(
        result
            .fm_peak_to_peak_cents
            .is_some_and(|cents| cents > 5.0),
        "peak-to-peak cents = {:?}",
        result.fm_peak_to_peak_cents
    );
    assert!(result.voiced_fraction > 0.8);
}

#[test]
fn a_steady_synth_tone_has_no_modulation_spectra() {
    let mono = render(&tone(440.0), 1.0);
    let result = run_mod(&mono, &mod_options());

    // A steady carrier produces only frame-grid ripple and YIN noise; it must not be
    // dressed up as a modulation rate.
    assert!(result.am_db.is_empty(), "am_db = {:?}", result.am_db);
    assert!(result.fm_db.is_empty(), "fm_db = {:?}", result.fm_db);
    assert!(result.mod_freqs.is_empty());
    assert!(result.am_peaks.is_empty() && result.fm_peaks.is_empty());
    assert!(result.am_depth.is_some_and(|depth| depth < 0.02));
    assert!(result.fm_std_cents.is_some_and(|cents| cents < 2.0));
}

#[test]
fn a_silent_synth_window_has_no_spectra_or_fm_run() {
    let mono = render(&silence(), 0.5);
    let result = run_mod(&mono, &mod_options());

    assert!(result.am_db.is_empty(), "am_db = {:?}", result.am_db);
    assert!(result.fm_db.is_empty(), "fm_db = {:?}", result.fm_db);
    assert!(result.am_peaks.is_empty() && result.fm_peaks.is_empty());
    assert_eq!(result.fm_run_start_secs, None);
    assert_eq!(result.fm_peak_to_peak_cents, None);
    assert_eq!(result.fm_rate_hz, None);
}

#[test]
fn the_modulation_range_is_clamped_against_aliasing() {
    // A 5 ms hop samples both the envelope and the FM track at 200 Hz, so 45% of
    // that is a 90 Hz ceiling — below the requested 500 Hz.
    let options = ToolOptions {
        hop_ms: Some(5.0),
        mod_max_hz: Some(500.0),
        ..mod_options()
    };
    let mono = render(&am_tone(440.0, &[(10.0, 0.5)]), 1.0);
    let result = run_mod(&mono, &options);

    assert!(
        (result.effective_mod_max_hz - 90.0).abs() < 0.5,
        "effective max = {} Hz",
        result.effective_mod_max_hz
    );
    let last = result.mod_freqs.last().copied().unwrap_or_default();
    assert!(last <= result.effective_mod_max_hz + 1e-3, "last = {last}");
}

#[test]
fn modulation_options_accept_snake_case_aliases() {
    let options: ToolOptions = serde_json::from_str(
        r#"{
            "mod_min_hz": 1,
            "mod_max_hz": 50,
            "detrend": 0,
            "min_voiced_secs": 0.4,
            "top_peaks": 5,
            "pitch_frame_ms": 20,
            "pitch_hop_ms": 2
        }"#,
    )
    .expect("aliases parse");
    assert_eq!(options.mod_min_hz, Some(1.0));
    assert_eq!(options.mod_max_hz, Some(50.0));
    assert_eq!(options.detrend, Some(0));
    assert_eq!(options.min_voiced_secs, Some(0.4));
    assert_eq!(options.top_peaks, Some(5));
    assert_eq!(options.pitch_frame_ms, Some(20.0));
    assert_eq!(options.pitch_hop_ms, Some(2.0));
}
