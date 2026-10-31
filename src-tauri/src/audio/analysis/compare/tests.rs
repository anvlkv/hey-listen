//! Comparison unit tests: the grid signature, the per-family delta, event pairing,
//! overlap/no-overlap, and shaping. See `docs/comparison.md` → "Tests".

use super::align::Span;
use super::diff::ComparisonDiff;
use super::events::{events_delta, EventsDelta};
use super::stats::DeltaStats;
use super::*;

use crate::audio::analysis::{Axis, RhythmResult, Shape, SharedParams, ToolOptions, WindowKind};
use crate::state::{SourcePcm, WindowState};

mod relative;

const RATE: u32 = 48_000;

fn state_with(samples: Vec<f32>) -> WindowState {
    let state = WindowState::default();
    state.audio.set_source(Some(SourcePcm {
        samples,
        sample_rate: RATE,
        channels: 1,
    }));
    state
}

/// A mono sine over `secs` seconds.
fn tone(secs: f64, hz: f32, amp: f32) -> Vec<f32> {
    let frames = (secs * f64::from(RATE)) as usize;
    (0..frames)
        .map(|frame| {
            let t = frame as f32 / RATE as f32;
            amp * (std::f32::consts::TAU * hz * t).sin()
        })
        .collect()
}

fn params() -> SharedParams {
    SharedParams {
        fft_size: 1024,
        hop: 0.5,
        randomized_overlap: false,
        window_fn: WindowKind::Hann,
        channel: None,
        resample_to: None,
        freq_min_hz: 0.0,
        freq_max_hz: 0.0,
    }
}

fn setup(start: f64, end: f64) -> CompareSetup {
    CompareSetup {
        start,
        end,
        params: params(),
        options: ToolOptions::default(),
    }
}

fn compare_pair(
    tool: AnalyzerId,
    a: (&WindowState, CompareSetup),
    b: (&WindowState, CompareSetup),
) -> Comparison {
    compare_pair_at(tool, a, b, 0.0)
}

fn compare_pair_at(
    tool: AnalyzerId,
    a: (&WindowState, CompareSetup),
    b: (&WindowState, CompareSetup),
    b_offset: f64,
) -> Comparison {
    let (a_state, a_setup) = a;
    let (b_state, b_setup) = b;
    compare(
        tool,
        SideInput {
            project: Some("A".to_string()),
            state: a_state,
            setup: a_setup,
        },
        SideInput {
            project: Some("B".to_string()),
            state: b_state,
            setup: b_setup,
        },
        b_offset,
    )
    .expect("comparison")
}

#[test]
fn aligned_grids_produce_a_series_delta() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );

    assert!(comparison.comparability.aligned);
    assert!(comparison.comparability.mismatches.is_empty());
    let Some(ComparisonDiff::Series(diff)) = &comparison.diff else {
        panic!("expected a series delta");
    };
    let mean = diff.stats.mean.expect("mean");
    assert!(
        (mean + 6.02).abs() < 0.5,
        "half amplitude should read about −6 dB, got {mean}"
    );
    assert!(
        diff.times.len() > 50,
        "matched frames: {}",
        diff.times.len()
    );
    assert_eq!(diff.values.len(), diff.times.len());
}

#[test]
fn a_differing_fft_size_is_a_mismatch() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 1.0));
    let mut a_setup = setup(0.0, 1.0);
    let mut b_setup = setup(0.0, 1.0);
    a_setup.params.fft_size = 1024;
    b_setup.params.fft_size = 2048;

    let comparison = compare_pair(AnalyzerId::Spectrum, (&a, a_setup), (&b, b_setup));
    assert!(!comparison.comparability.aligned);
    assert!(comparison.diff.is_none());
    assert!(comparison
        .comparability
        .mismatches
        .iter()
        .any(|mismatch| mismatch.key == "fftSize"));
    // Both results are still returned, so the view can show them side by side.
    assert!(matches!(
        comparison.a.result,
        crate::audio::analysis::AnalysisResult::Spectrum(_)
    ));
}
#[test]
fn a_spectrum_compares_without_time_overlap() {
    let a = state_with(tone(2.0, 440.0, 1.0));
    let b = state_with(tone(2.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::Spectrum,
        (&a, setup(0.0, 1.0)),
        (&b, setup(1.0, 2.0)),
    );
    assert!(comparison.comparability.aligned);
    let Some(ComparisonDiff::Spectrum(diff)) = &comparison.diff else {
        panic!("expected a spectrum delta");
    };
    assert_eq!(diff.freqs.len(), diff.values.len());
    assert!(diff.stats.max_abs.is_some());
}

#[test]
fn a_differing_channel_is_a_mismatch() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 1.0));
    let mut a_setup = setup(0.0, 1.0);
    let mut b_setup = setup(0.0, 1.0);
    a_setup.params.channel = None;
    b_setup.params.channel = Some(0);
    let comparison = compare_pair(AnalyzerId::LoudnessIntegrated, (&a, a_setup), (&b, b_setup));
    assert!(comparison
        .comparability
        .mismatches
        .iter()
        .any(|mismatch| mismatch.key == "channel"));
    // A differing channel changes the signal being compared, so no numeric delta.
    assert!(!comparison.comparability.aligned);
    assert!(comparison.diff.is_none());
}

#[test]
fn a_level_delta_names_its_fields() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::Levels,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );
    let Some(ComparisonDiff::Scalar(diff)) = &comparison.diff else {
        panic!("expected a scalar delta");
    };
    let rms = diff
        .fields
        .iter()
        .find(|field| field.key == "rmsDb")
        .expect("rmsDb");
    assert!((rms.delta + 6.02).abs() < 0.5, "rmsDb delta {}", rms.delta);
    assert!(diff.header.summary.contains("Δ rmsDb"));
}

#[test]
fn events_are_paired_by_nearest_time() {
    let a = rhythm(&[0.10, 0.40, 0.70]);
    let b = rhythm(&[0.11, 0.70, 1.00]);
    let delta = events_delta(
        &a,
        &b,
        0.0,
        0.0,
        0.0,
        Some(Span {
            start: 0.0,
            end: 1.0,
        }),
        0.01,
    );
    let onsets = &delta.onsets;
    assert_eq!(onsets.matched, 2, "0.10↔0.11 and 0.70↔0.70");
    assert_eq!(onsets.only_a, 1, "0.40 exists on A only");
    assert_eq!(onsets.only_b, 1, "1.00 exists on B only");
    assert!(onsets.mean_abs_dt.unwrap() < 0.02);
    assert_eq!(onsets.pairs[0].a, 0.10);
    assert_eq!(onsets.pairs[0].b, 0.11);
}

#[test]
fn events_outside_the_common_span_are_ignored() {
    let a = rhythm(&[0.10, 0.90]);
    let b = rhythm(&[0.90]);
    let delta = events_delta(
        &a,
        &b,
        0.0,
        0.0,
        0.0,
        Some(Span {
            start: 0.5,
            end: 1.0,
        }),
        0.01,
    );
    assert_eq!(delta.onsets.matched, 1);
    assert_eq!(delta.onsets.only_a, 0);
    assert_eq!(delta.onsets.only_b, 0);
}

#[test]
fn stats_describe_the_delta() {
    let stats = DeltaStats::of(&[(1.0, 2.0), (4.0, 1.0)]);
    assert_eq!(stats.matched, 2);
    assert_eq!(stats.min, Some(-3.0));
    assert_eq!(stats.max, Some(1.0));
    assert_eq!(stats.max_abs, Some(3.0));
    assert_eq!(stats.mean, Some(-1.0));
    assert!(stats.describe().contains("max |Δ| 3.00"));
}

#[test]
fn compact_shaping_keeps_stats_and_drops_arrays() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );
    let value = comparison.to_value(Shape::Compact, None, Axis::Array);
    assert_eq!(value["diff"]["kind"], "series");
    assert_eq!(value["diff"]["values"].as_array().unwrap().len(), 0);
    assert!(value["diff"]["stats"]["matched"].as_u64().unwrap() > 0);
    assert!(value["diff"]["summary"].as_str().unwrap().contains("pairs"));
    // Both sides are compacted, not raw.
    assert!(value["a"]["result"]["values"].is_object());
}

#[test]
fn summary_shaping_omits_the_results() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::Levels,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );
    let value = comparison.to_value(Shape::Summary, None, Axis::Array);
    assert!(value["a"].get("result").is_none());
    assert!(value["a"]["summary"]["text"].is_string());
}

#[test]
fn full_shaping_returns_the_delta_arrays() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );
    let value = comparison.to_value(Shape::Full, None, Axis::Array);
    assert!(!value["diff"]["values"].as_array().unwrap().is_empty());
    assert!(value["a"]["result"]["times"].is_array());
}

#[test]
fn max_points_thins_the_delta_arrays_and_keeps_them_aligned() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );
    let value = comparison.to_value(Shape::Full, Some(8), Axis::Array);
    let diff = &value["diff"];
    for key in ["times", "values", "a", "b"] {
        assert_eq!(
            diff[key].as_array().unwrap().len(),
            8,
            "{key} must be thinned with the rest"
        );
    }
    // The stats and summary still describe the full comparison.
    assert!(diff["stats"]["matched"].as_u64().unwrap() > 8);
    assert!(diff["summary"].as_str().unwrap().contains("pairs"));
}

#[test]
fn a_pitch_track_compares_as_a_series() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 220.0, 1.0));
    let comparison = compare_pair(
        AnalyzerId::PitchYin,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );
    // Pitch is a gapped series, not a scalar readout: no constant-field noise.
    let Some(ComparisonDiff::Series(diff)) = &comparison.diff else {
        panic!("expected a series delta for a pitch track");
    };
    assert!(diff.stats.matched > 20, "voiced frames matched");
    let mean = diff.stats.mean.expect("mean f0 delta");
    assert!(
        mean < -100.0,
        "half the frequency should be about −220 Hz, got {mean}"
    );
}

#[test]
fn wire_options_round_trip_into_tool_options() {
    // The peer's effective options are sent straight back as B's setup, so a count must
    // reach the wire as an integer (the catalog reports every default as `f64`).
    let options = ToolOptions {
        n_mfcc: Some(13),
        frame_ms: Some(2.5),
        ..Default::default()
    };
    let value =
        super::align::effective_options(crate::audio::analyzers::AnalyzerId::Mfcc, &options);
    assert_eq!(value["nMfcc"], serde_json::json!(13));
    assert_eq!(value["frameMs"], serde_json::json!(2.5));
    let parsed: ToolOptions =
        serde_json::from_value(value).expect("a peer's options must round-trip");
    assert_eq!(parsed.n_mfcc, Some(13));
    assert_eq!(parsed.frame_ms, Some(2.5));
}

/// A rhythm result whose onsets are the given times (envelope over 1 s).
fn rhythm(onsets: &[f32]) -> RhythmResult {
    let hop = 0.01f32;
    let frames = 100usize;
    RhythmResult {
        bpm: 120.0,
        confidence: 0.5,
        hop_size: 480,
        times: (0..frames).map(|frame| frame as f32 * hop).collect(),
        window_start: 0.0,
        onset_strength: vec![0.0; frames],
        onset_times: onsets.to_vec(),
        beat_times: Vec::new(),
        downbeat_times: Vec::new(),
    }
}

#[test]
fn a_rhythm_delta_carries_paired_events() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 1.0));
    let comparison = compare_pair(
        AnalyzerId::Onsets,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );
    let Some(ComparisonDiff::Events(EventsDelta { onsets, .. })) = &comparison.diff else {
        panic!("expected an events delta");
    };
    // Identical sources: every detected onset is matched (or neither side has one).
    assert_eq!(onsets.only_a, 0);
    assert_eq!(onsets.only_b, 0);
}
