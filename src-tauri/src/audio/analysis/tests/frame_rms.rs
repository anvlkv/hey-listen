//! Frame-RMS amplitude envelope tests (M17): level accuracy, the silence floor, a
//! sub-frame window, and the echoed frame / hop.

use super::*;

fn frame_rms_options(frame_ms: f32, hop_ms: f32) -> ToolOptions {
    ToolOptions {
        frame_ms: Some(frame_ms),
        hop_ms: Some(hop_ms),
        ..ToolOptions::default()
    }
}

fn run_frame_rms(mono: &[f32], options: &ToolOptions) -> SeriesResult {
    match run("frameRms", mono, RATE, &params(2048), options).expect("frame rms") {
        AnalysisResult::FrameRms(result) => result,
        other => panic!("unexpected result: {other:?}"),
    }
}

#[test]
fn frame_rms_reads_a_half_scale_sine_in_dbfs() {
    let mono = sine(1_000.0, 0.5);
    let result = run_frame_rms(&mono, &ToolOptions::default());
    // A half-scale sine has RMS = 0.5 / √2, about −9 dBFS.
    assert!(result.frames > 0);
    for value in result.values.iter().flatten() {
        assert!((value + 9.03).abs() < 0.1, "level = {value} dBFS");
    }
    // The first frame is centred on the audio it measures, not at the window start.
    let first = result.times.first().copied().unwrap_or_default();
    assert!((first - 0.005).abs() < 1e-3, "first time = {first}");
}

#[test]
fn frame_rms_floors_a_silent_window() {
    let mono = vec![0.0f32; RATE as usize / 10];
    let result = run_frame_rms(&mono, &ToolOptions::default());
    assert!(!result.values.is_empty());
    assert!(result.values.iter().all(|value| *value == Some(DB_FLOOR)));
    assert_eq!(result.min_value, DB_FLOOR);
    assert_eq!(result.max_value, DB_FLOOR);
}

#[test]
fn frame_rms_short_window_still_yields_one_value() {
    // 5 ms of audio inside a 10 ms frame: one value over the samples present.
    let mono = sine(1_000.0, 0.005);
    let result = run_frame_rms(&mono, &ToolOptions::default());
    assert_eq!(result.frames, 1);
    assert_eq!(result.values.len(), 1);
    assert_eq!(result.frame_size, Some(480));
    let level = result.values[0].expect("a value");
    assert!((level + 9.03).abs() < 0.1, "level = {level} dBFS");
}

#[test]
fn frame_rms_echoes_the_configured_frame_and_hop() {
    let mono = sine(1_000.0, 0.5);
    let result = run_frame_rms(&mono, &frame_rms_options(20.0, 10.0));
    // 20 ms / 10 ms at 48 kHz → 960 / 480 samples.
    assert_eq!(result.frame_size, Some(960));
    assert_eq!(result.hop_size, 480);
    // 24 000 samples with a 960-sample frame on a 480-sample hop: 49 frames.
    assert_eq!(result.frames, 49);
    // The effective frame / hop also survive the wire form (MCP / CLI / project).
    let wire = serde_json::to_value(&result).expect("serialize");
    assert_eq!(wire["frameSize"], 960);
    assert_eq!(wire["hopSize"], 480);
}

#[test]
fn frame_rms_options_accept_snake_case_aliases() {
    let options: ToolOptions =
        serde_json::from_str(r#"{ "frame_ms": 20, "hop_ms": 10 }"#).expect("aliases parse");
    assert_eq!(options.frame_ms, Some(20.0));
    assert_eq!(options.hop_ms, Some(10.0));
}
