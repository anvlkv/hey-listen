//! Headless coverage for the M20 modulation tool: an **AM synth graph** is rendered
//! through `render_synth`, the option patch (aliases) reaches the engine, and the
//! result keeps the spectra, peaks, depth, and effective range.

use serde_json::{json, Value};

use super::super::HeadlessSession;

/// A synth graph: `sine(440) × (1 + 0.5·sin(2π·10·t))` — a 50%-depth 10 Hz AM tone.
fn am_graph_value() -> Value {
    json!({
        "nodes": [
            { "id": "osc", "kind": "sine", "params": [440.0] },
            { "id": "lfo", "kind": "sine_lfo", "params": [10.0, 0.5, 1.0] },
            { "id": "mult", "kind": "multiply", "params": [] },
            { "id": "out", "kind": "output", "params": [] },
        ],
        "edges": [
            { "from": "osc", "fromPort": 0, "to": "mult", "toPort": 0 },
            { "from": "lfo", "fromPort": 0, "to": "mult", "toPort": 1 },
            { "from": "mult", "fromPort": 0, "to": "out", "toPort": 0 },
        ],
    })
}

#[test]
fn modulation_options_flow_through_the_headless_session() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": am_graph_value(), "seconds": 1.5 }),
        )
        .unwrap();
    session
        .dispatch(
            "set_tool_options",
            json!({
                "tool": "modulation",
                "options": {
                    "mod_max_hz": 500,
                    "detrend": 0,
                    "min_voiced_secs": 0.3,
                    "top_peaks": 4,
                    "min_f0_hz": 300,
                    "max_f0_hz": 700,
                },
            }),
        )
        .expect("snake_case aliases are accepted");

    let modulation = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "modulation", "includeData": true }),
        )
        .unwrap();
    assert_eq!(modulation["result"]["tool"], "modulation");
    // The requested 500 Hz is clamped to ~45% of the slower analysis rate.
    let effective = modulation["result"]["effectiveModMaxHz"]
        .as_f64()
        .expect("an effective max");
    assert!(
        effective > 0.0 && effective < 500.0,
        "effective = {effective}"
    );
    let freqs = modulation["result"]["modFreqs"].as_array().unwrap();
    let am = modulation["result"]["amDb"].as_array().unwrap();
    assert!(!freqs.is_empty());
    assert_eq!(freqs.len(), am.len());
    // The AM spectrum's strongest peak is the graph's 10 Hz LFO.
    let peaks = modulation["result"]["amPeaks"].as_array().unwrap();
    assert!(peaks.len() <= 4);
    let top = peaks[0]["rateHz"].as_f64().expect("a top rate");
    assert!((top - 10.0).abs() < 1.5, "top AM rate = {top} Hz");
    // The graph's envelope is 1 ± 0.5, so the depth is about 50%.
    let depth = modulation["result"]["amDepth"].as_f64().expect("a depth");
    assert!((depth - 0.5).abs() < 0.1, "am depth = {depth}");

    assert_eq!(modulation["options"]["modMaxHz"], 500.0);
    assert_eq!(modulation["options"]["detrend"], 0.0);
    assert!((modulation["options"]["minVoicedSecs"].as_f64().unwrap() - 0.3).abs() < 1e-6);
    assert_eq!(modulation["options"]["topPeaks"], 4.0);
}
