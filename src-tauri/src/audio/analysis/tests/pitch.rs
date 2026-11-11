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
        AnalyzerId::PitchYin,
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
        AnalyzerId::PitchYin,
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
        AnalyzerId::HarmonicRatio,
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

/// Run pYIN over a `hz` sine with an explicit `(min, max)` range.
fn pyin(hz: f32, range: (f32, f32)) -> PitchResult {
    pyin_on(2048, hz, range)
}

/// Run pYIN over a `hz` sine on `fft`-sized frames, with an explicit `(min, max)` range.
fn pyin_on(fft: usize, hz: f32, (min_f0_hz, max_f0_hz): (f32, f32)) -> PitchResult {
    let mono = sine(hz, 0.5);
    match run(
        AnalyzerId::PitchPyin,
        &mono,
        RATE,
        &params(fft),
        &pitch_options(min_f0_hz, max_f0_hz),
    )
    .expect("pitch")
    {
        AnalysisResult::PitchPyin(result) => result,
        other => panic!("unexpected result: {other:?}"),
    }
}

/// Every voiced f0 must lie inside the domain the result reports.
fn assert_inside_reported_domain(result: &PitchResult) {
    for f0 in result.values.iter().flatten() {
        assert!(
            *f0 >= result.effective_min_f0_hz && *f0 <= result.effective_max_f0_hz,
            "{f0} Hz is outside the reported {}–{} Hz domain",
            result.effective_min_f0_hz,
            result.effective_max_f0_hz
        );
    }
}

#[test]
fn pyin_reports_its_effective_range() {
    let result = pyin(440.0, (50.0, 2_000.0));
    // The reported domain is the *realized* one — semitone bin centres inside the
    // request — so the ceiling is not the requested 2000 Hz (it falls between bins).
    assert!(result.effective_min_f0_hz >= 50.0);
    assert!(result.effective_max_f0_hz <= 2_000.0);
    assert!(
        result.effective_max_f0_hz < 2_000.0,
        "an echoed request is not an effective bound"
    );
    let mean = mean_f0(&result);
    assert!((mean - 440.0).abs() < 20.0, "mean f0 = {mean}");
    assert_inside_reported_domain(&result);
}

/// The report's finding: pYIN hardcoded 50–2000 Hz, so a high fundamental was
/// unreachable and cross-tracker agreement above 2 kHz could not be evaluated
/// (hey-listen-report §2.2/§6.2).
#[test]
fn pyin_finds_a_three_khz_f0_with_an_explicit_range() {
    let result = pyin(3_000.0, (50.0, 4_000.0));
    assert!(result.effective_max_f0_hz <= 4_000.0);
    let mean = mean_f0(&result);
    // The detector reports semitone bin centres, so allow ~a semitone.
    assert!((mean - 3_000.0).abs() < 120.0, "mean f0 = {mean}");
    assert_inside_reported_domain(&result);
}

/// The documented limitation: a tone above the range is not recovered. The periodicity
/// search only sees lags inside the range, so a 3 kHz tone under the default 2 kHz
/// ceiling is reported as its ~1.48 kHz subharmonic. This is a limitation of the
/// constrained search, not something a stronger assertion on the old test could fix.
#[test]
fn a_tone_above_the_range_is_reported_as_a_subharmonic() {
    let result = pyin(3_000.0, (50.0, 2_000.0));
    let mean = mean_f0(&result);
    assert!((mean - 1_480.0).abs() < 30.0, "mean f0 = {mean}");
    assert_inside_reported_domain(&result);
}

/// A range thinner than the semitone grid has no reportable bin centre: the result says
/// so (empty domain, no voiced frames) instead of returning 466.16 Hz for a 450–460 Hz
/// request — the audit's executed probe.
#[test]
fn a_tight_range_without_a_bin_reports_nothing_outside_it() {
    let result = pyin(455.0, (450.0, 460.0));
    assert_eq!(result.voiced_frames, 0);
    assert_eq!(
        (result.effective_min_f0_hz, result.effective_max_f0_hz),
        (0.0, 0.0)
    );
}

/// A range wide enough for one semitone bin reports that centre, inside the range.
#[test]
fn a_tight_range_reports_its_bin_centre_inside_the_range() {
    let result = pyin(440.0, (430.0, 450.0));
    let voiced: Vec<f32> = result.values.iter().flatten().copied().collect();
    assert!(!voiced.is_empty(), "440 Hz is the one bin in 430–450 Hz");
    assert!(
        voiced.iter().all(|f0| (430.0..=450.0).contains(f0)),
        "{voiced:?}"
    );
    assert!(result.effective_min_f0_hz >= 430.0 && result.effective_max_f0_hz <= 450.0);
    let mean = mean_f0(&result);
    assert!((mean - 440.0).abs() < 1.0, "mean f0 = {mean}");
}

/// A tone near the top edge is never rounded up past the requested ceiling: under
/// 440–460 Hz only the 440 Hz bin is representable, and 466.16 Hz is not reported.
#[test]
fn a_tone_near_the_top_edge_is_never_reported_above_it() {
    let result = pyin(455.0, (440.0, 460.0));
    assert!(result.effective_max_f0_hz <= 460.0);
    assert!(
        result
            .values
            .iter()
            .flatten()
            .all(|f0| (440.0..=460.0).contains(f0)),
        "{:?}",
        result.values
    );
    assert_inside_reported_domain(&result);
}

/// A short frame cannot search the lowest requested lags: the reported domain is narrowed
/// to what the frame's half-length allows instead of echoing `minF0Hz`.
#[test]
fn pyin_reports_the_domain_the_frame_can_realize() {
    let result = pyin_on(256, 1_000.0, (50.0, 5_000.0));
    // 48 kHz / (256 frame / 2) = 375 Hz is the lowest lag a 256-sample frame allows.
    assert!(
        result.effective_min_f0_hz >= 375.0,
        "effective min = {}",
        result.effective_min_f0_hz
    );
    assert!(result.effective_min_f0_hz > 50.0);
    assert_inside_reported_domain(&result);
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
    let result = match run(
        AnalyzerId::PitchYin,
        &mono,
        RATE,
        &p,
        &ToolOptions::default(),
    )
    .expect("pitch")
    {
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
        // The confidence track is parallel to `values`: present on voiced frames only.
        assert_eq!(result.confidence.len(), result.values.len());
        assert_eq!(
            result
                .confidence
                .iter()
                .filter(|value| value.is_some())
                .count(),
            voiced
        );
    }
}

/// The pYIN payload: the candidate grid is `frames × bins`, every probability is in
/// `[0, 1]`, and there is one row per returned frame — the evidence the f0 track was
/// chosen from.
#[test]
fn pyin_reports_a_candidate_grid_aligned_with_its_frames() {
    let result = pyin(440.0, (50.0, 2_000.0));
    let grid = result.candidates.as_ref().expect("pYIN reports candidates");
    assert_eq!(grid.freqs.len(), grid.bins);
    assert_eq!(grid.values.len(), result.frames * grid.bins);
    assert_eq!(grid.values.len() / grid.bins, result.times.len());
    assert!(grid
        .values
        .iter()
        .all(|probability| (0.0..=1.0).contains(probability)));
    // A voiced frame picked a bin that carries candidate mass; the rows stay aligned.
    for (frame, value) in result.values.iter().enumerate() {
        let row = &grid.values[frame * grid.bins..(frame + 1) * grid.bins];
        if value.is_some() {
            assert!(
                row.iter().any(|&probability| probability > 0.0),
                "voiced frame {frame} has no candidate"
            );
        }
    }
    // The octave flags are parallel to `values`, one per frame.
    assert_eq!(result.octave_ambiguous.len(), result.values.len());
}

/// Only pYIN reports candidates; the other trackers leave the payload absent.
#[test]
fn non_pyin_detectors_report_no_candidates() {
    let mono = sine(440.0, 0.5);
    for tool in [AnalyzerId::PitchYin, AnalyzerId::PitchAutocorr] {
        let result =
            match run(tool, &mono, RATE, &params(2048), &ToolOptions::default()).expect("pitch") {
                AnalysisResult::PitchYin(r) | AnalysisResult::PitchAutocorr(r) => r,
                other => panic!("unexpected result: {other:?}"),
            };
        assert!(result.candidates.is_none());
        assert!(result.octave_ambiguous.is_empty());
    }
}

/// Harmonic ratio takes the same explicit range: a 3 kHz tone inside a 2–4 kHz band
/// scores high, so the tool is not silently capped at 2 kHz (hey-listen-report §6.2).
#[test]
fn harmonic_ratio_honours_an_explicit_high_range() {
    let mono = sine(3_000.0, 0.5);
    let result = match run(
        AnalyzerId::HarmonicRatio,
        &mono,
        RATE,
        &params(2048),
        &pitch_options(2_000.0, 4_000.0),
    )
    .expect("harmonic ratio")
    {
        AnalysisResult::HarmonicRatio(r) => r,
        other => panic!("unexpected result: {other:?}"),
    };
    let mean = mean_series(&result);
    assert!(mean > 0.8, "mean harmonic ratio = {mean}");
}
