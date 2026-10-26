//! Pitch-range and option-integrity tests (M16): the f0 range reaches the
//! detector, the effective range is reported, and option keys are validated.

use super::*;

fn pitch_options(min_f0_hz: f32, max_f0_hz: f32) -> ToolOptions {
    ToolOptions {
        min_f0_hz: Some(min_f0_hz),
        max_f0_hz: Some(max_f0_hz),
        ..ToolOptions::default()
    }
}

/// The mean of a pitch track's voiced frames (asserting there is at least one).
fn mean_f0(result: &PitchResult) -> f32 {
    let (sum, count) = result
        .values
        .iter()
        .flatten()
        .fold((0.0f32, 0usize), |(sum, n), value| (sum + value, n + 1));
    assert!(count > 0, "expected some voiced frames");
    sum / count as f32
}

/// The mean of a scalar series' non-gap frames.
fn mean_series(result: &SeriesResult) -> f32 {
    let (sum, count) = result
        .values
        .iter()
        .flatten()
        .fold((0.0f32, 0usize), |(sum, n), value| (sum + value, n + 1));
    assert!(count > 0, "expected some values");
    sum / count as f32
}
#[test]
fn pitch_yin_finds_a_low_f0_inside_an_explicit_range() {
    let mono = sine(75.0, 1.0);
    let result = match run(
        "pitchYin",
        &mono,
        RATE,
        &params(2048),
        &pitch_options(50.0, 500.0),
    )
    .expect("pitch")
    {
        AnalysisResult::PitchYin(r) => r,
        other => panic!("unexpected result: {other:?}"),
    };
    // The requested range reaches the detector and is reported back.
    assert_eq!(result.effective_min_f0_hz, 50.0);
    assert_eq!(result.effective_max_f0_hz, 500.0);
    let mean = mean_f0(&result);
    assert!((mean - 75.0).abs() < 3.0, "mean f0 = {mean}");
}

#[test]
fn yin_can_search_above_two_khz_when_the_range_allows_it() {
    let mono = sine(3_000.0, 1.0);
    let result = match run(
        "pitchYin",
        &mono,
        RATE,
        &params(2048),
        &pitch_options(50.0, 4_000.0),
    )
    .expect("pitch")
    {
        AnalysisResult::PitchYin(r) => r,
        other => panic!("unexpected result: {other:?}"),
    };
    let mean = mean_f0(&result);
    assert!((mean - 3_000.0).abs() < 60.0, "mean f0 = {mean}");
}

#[test]
fn harmonic_ratio_defaults_reach_three_khz() {
    let mono = sine(3_000.0, 0.5);
    let result = match run(
        "harmonicRatio",
        &mono,
        RATE,
        &params(2048),
        &ToolOptions::default(),
    )
    .expect("harmonic ratio")
    {
        AnalysisResult::HarmonicRatio(r) => r,
        other => panic!("unexpected result: {other:?}"),
    };
    let mean = mean_series(&result);
    assert!(mean > 0.8, "mean harmonic ratio = {mean}");
}

#[test]
fn pyin_reports_its_fixed_effective_range() {
    let mono = sine(440.0, 0.5);
    let result = match run(
        "pitchPyin",
        &mono,
        RATE,
        &params(2048),
        &ToolOptions::default(),
    )
    .expect("pitch")
    {
        AnalysisResult::PitchPyin(r) => r,
        other => panic!("unexpected result: {other:?}"),
    };
    // oxiaudio's pYIN hardcodes this window; report it instead of a range it ignores.
    assert_eq!(result.effective_min_f0_hz, 50.0);
    assert_eq!(result.effective_max_f0_hz, 2_000.0);
}

#[test]
fn tool_options_accept_snake_case_aliases_and_reject_unknown_keys() {
    let options: ToolOptions = serde_json::from_str(
        r#"{ "min_f0_hz": 50, "max_f0_hz": 4000, "yin_threshold": 0.1, "n_mels": 32 }"#,
    )
    .expect("aliases parse");
    assert_eq!(options.min_f0_hz, Some(50.0));
    assert_eq!(options.max_f0_hz, Some(4_000.0));
    assert_eq!(options.yin_threshold, Some(0.1));
    assert_eq!(options.n_mels, Some(32));

    let error = serde_json::from_str::<ToolOptions>(r#"{ "min_freq_hz": 50 }"#)
        .expect_err("an unknown key must fail");
    assert!(error.to_string().contains("unknown field"), "{error}");
}

#[test]
fn the_spectral_band_does_not_change_the_pitch_search() {
    // The shared band limit is spectral-only: a 440 Hz tone still tracks even when
    // the band is 1–1.5 kHz.
    let mono = sine(440.0, 0.5);
    let mut p = params(2048);
    p.freq_min_hz = 1_000.0;
    p.freq_max_hz = 1_500.0;
    let result = match run("pitchYin", &mono, RATE, &p, &ToolOptions::default()).expect("pitch") {
        AnalysisResult::PitchYin(r) => r,
        other => panic!("unexpected result: {other:?}"),
    };
    let mean = mean_f0(&result);
    assert!((mean - 440.0).abs() < 8.0, "mean f0 = {mean}");
}

#[test]
fn f0_reliability_needs_enough_voiced_frames() {
    use oxiaudio::dsp::PitchFrame;

    let track = |voiced: usize, total: usize| -> Vec<PitchFrame> {
        (0..total)
            .map(|index| PitchFrame {
                time_seconds: index as f64 * 0.01,
                frequency_hz: if index < voiced { 440.0 } else { 0.0 },
                confidence: if index < voiced { 1.0 } else { 0.0 },
                is_voiced: index < voiced,
            })
            .collect()
    };

    for (voiced, reliable) in [
        (0usize, false),
        (1, false),
        (3, false),
        (7, false),
        (8, true),
        (20, true),
    ] {
        let result =
            super::super::support::pitch_series(track(voiced, 24), 480, RATE, (50.0, 2_000.0));
        assert_eq!(result.voiced_frames, voiced);
        assert_eq!(result.f0_reliable, reliable, "voiced frames = {voiced}");
    }
}
