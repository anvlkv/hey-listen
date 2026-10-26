//! Window-gate tests (M21.B): a measurement can exclude frames far below the window
//! peak, the effective gate is reported, and the shape of an ungated result is
//! unchanged.

use super::*;

fn run_series(tool: &str, mono: &[f32], options: &ToolOptions) -> SeriesResult {
    let result = run(tool, mono, RATE, &params(2048), options).expect("a series tool");
    result.series().expect("a scalar-per-frame result").clone()
}

#[test]
fn an_ungated_series_has_no_gate_metadata() {
    let mono = sine(1_000.0, 0.5);
    let result = run_series("frameRms", &mono, &ToolOptions::default());
    assert!(result.gate.is_none());
    assert!(result.values.iter().all(Option::is_some));
}

#[test]
fn the_window_gate_excludes_quiet_frames() {
    // Half a second at −9 dBFS, then the same tone 40 dB down.
    let mut mono = sine(1_000.0, 0.5);
    mono.extend(sine(1_000.0, 0.5).into_iter().map(|sample| sample * 0.01));
    let options = ToolOptions {
        gate_db: Some(20.0),
        ..ToolOptions::default()
    };
    let gated = run_series("frameRms", &mono, &options);

    let gate = gated.gate.expect("the effective gate");
    assert_eq!(gate.gate_db, 20.0);
    assert_eq!(gate.gate_floor_db, DB_FLOOR);
    assert_eq!(gate.gated_frames + gate.kept_frames, gated.frames);
    assert!(
        gate.gated_frames > 0 && gate.kept_frames > 0,
        "gate = {gate:?}"
    );
    // A 20 dB gate from a −9 dBFS peak is about −29 dBFS, so every quiet frame is a gap.
    assert!(
        (gate.threshold_db + 29.0).abs() < 3.0,
        "threshold = {}",
        gate.threshold_db
    );
    let present = gated.values.iter().flatten().count();
    assert_eq!(present, gate.kept_frames);
    assert!(gated
        .values
        .iter()
        .flatten()
        .all(|value| *value > gate.threshold_db));
}

#[test]
fn the_gate_applies_to_spectral_series() {
    // Half a second of silence, then a 1 kHz tone: the silent frames must not drag the
    // centroid, which is exactly the A/B failure (M21.B).
    let mut mono = vec![0.0f32; RATE as usize / 2];
    mono.extend(sine(1_000.0, 0.5));
    let options = ToolOptions {
        gate_db: Some(30.0),
        ..ToolOptions::default()
    };
    let gated = run_series("spectralCentroid", &mono, &options);

    let gate = gated.gate.expect("the effective gate");
    assert!(gate.gated_frames > 0, "gate = {gate:?}");
    assert!(gated.values.iter().any(Option::is_none));
    let present: Vec<f32> = gated.values.iter().flatten().copied().collect();
    assert!(!present.is_empty());
    assert!(
        present.iter().all(|hz| (hz - 1_000.0).abs() < 200.0),
        "a gated centroid must stay near the tone: {present:?}"
    );
}

#[test]
fn the_gate_floor_is_absolute() {
    // A quiet recording (peak ≈ −56 dBFS): a relative 20 dB gate would leave it alone,
    // but a −30 dBFS floor excludes everything.
    let mono: Vec<f32> = sine(1_000.0, 0.5)
        .into_iter()
        .map(|sample| sample * 0.003)
        .collect();
    let options = ToolOptions {
        gate_db: Some(20.0),
        gate_floor_db: Some(-30.0),
        ..ToolOptions::default()
    };
    let gated = run_series("frameRms", &mono, &options);

    let gate = gated.gate.expect("the effective gate");
    assert_eq!(gate.threshold_db, -30.0);
    assert_eq!(gate.gated_frames, gated.frames);
    assert!(gated.values.iter().all(Option::is_none));
}
