//! The `loudness` / `specificLoudness` tools through the shared dispatcher (M27).

use super::{calibration, median, params, tone, RATE};
use crate::audio::analysis::psychoacoustics::bands::critical_band_edges;
use crate::audio::analysis::psychoacoustics::scales::{bark, cam, Scale};
use crate::audio::analysis::{run, AnalysisResult, LoudnessResult, MatrixResult, ToolOptions};
use crate::audio::analyzers::AnalyzerId;

fn loudness_result(mono: &[f32], options: &ToolOptions) -> LoudnessResult {
    match run(AnalyzerId::Loudness, mono, RATE, &params(2048), options).expect("loudness") {
        AnalysisResult::Loudness(result) => result,
        other => panic!("unexpected result: {other:?}"),
    }
}

fn specific_result(mono: &[f32], options: &ToolOptions) -> MatrixResult {
    match run(
        AnalyzerId::SpecificLoudness,
        mono,
        RATE,
        &params(2048),
        options,
    )
    .expect("specific loudness")
    {
        AnalysisResult::SpecificLoudness(result) => result,
        other => panic!("unexpected result: {other:?}"),
    }
}

#[test]
fn uncalibrated_loudness_is_labelled_and_relative() {
    let result = loudness_result(&tone(0.5, 1_000.0, 0.5), &ToolOptions::default());
    assert!(!result.calibrated);
    assert_eq!(result.calibration_db_spl, 0.0);
    assert_eq!(result.loudness_sone.len(), result.times.len());
    assert_eq!(result.loudness_phon.len(), result.times.len());
    assert!(result
        .loudness_sone
        .iter()
        .flatten()
        .all(|value| value.is_finite() && *value >= 0.0));
}

#[test]
fn a_calibrated_40_db_spl_tone_reads_about_one_sone() {
    // A full-scale sine is 94 dB SPL, so −54 dBFS is 40 dB SPL.
    let db_fs = -54.0;
    let mono = tone(10f32.powf(db_fs / 20.0), 1_000.0, 0.5);
    let result = loudness_result(&mono, &calibration(94.0));
    assert!(result.calibrated);
    assert_eq!(result.calibration_db_spl, 94.0);
    let sone = median(&result.loudness_sone);
    assert!(
        (sone - 1.0).abs() <= 0.2,
        "calibrated 1 kHz / 40 dB SPL reads {sone} sone, expected 1 ± 20%"
    );
    assert!(
        (median(&result.loudness_phon) - 40.0).abs() <= 3.0,
        "loudness level {} phon, expected ~40",
        median(&result.loudness_phon)
    );
}

#[test]
fn a_louder_copy_raises_the_sone_series() {
    let quiet = loudness_result(&tone(0.05, 1_000.0, 0.5), &ToolOptions::default());
    let loud = loudness_result(&tone(0.5, 1_000.0, 0.5), &ToolOptions::default());
    assert!(
        median(&loud.loudness_sone) > median(&quiet.loudness_sone),
        "a +20 dB copy did not raise the loudness"
    );
}

#[test]
fn the_rms_comparator_is_parallel_to_times_and_spl_needs_a_calibration() {
    let mono = tone(0.5, 1_000.0, 0.5);
    // An uncalibrated run has no absolute reference, so it reports no SPL at all.
    let relative = loudness_result(&mono, &ToolOptions::default());
    assert_eq!(relative.frame_rms_db.len(), relative.times.len());
    assert!(relative.frame_spl_db.is_empty());
    assert!(relative
        .frame_rms_db
        .iter()
        .flatten()
        .all(|level| level.is_finite()));
    // A half-scale sine's RMS is 0.5/√2 → −9.03 dBFS. A generic `<= 0` bound would
    // accept a peak reading or a wrong window; pin the actual level.
    let median_rms = median(&relative.frame_rms_db);
    assert!(
        (median_rms - (-9.0309)).abs() < 0.2,
        "a half-scale sine's RMS reads {median_rms} dBFS, expected ≈ −9.03"
    );
    // Silence is floored at the analysis floor, never −∞.
    let silent = loudness_result(&vec![0.0; RATE as usize / 2], &ToolOptions::default());
    assert!(
        silent
            .frame_rms_db
            .iter()
            .all(|level| *level == Some(-120.0)),
        "a silent comparator frame is not floored at −120 dBFS"
    );

    // A calibrated run reports SPL as the same RMS level plus the calibration offset.
    let absolute = loudness_result(&mono, &calibration(94.0));
    assert_eq!(absolute.frame_rms_db.len(), absolute.times.len());
    assert_eq!(absolute.frame_spl_db.len(), absolute.times.len());
    for (rms, spl) in absolute.frame_rms_db.iter().zip(&absolute.frame_spl_db) {
        let (Some(rms), Some(spl)) = (rms, spl) else {
            panic!("a frame carries a level on one axis only");
        };
        assert!((spl - (rms + 94.0)).abs() < 1e-4, "{spl} ≠ {rms} + 94");
    }
}

#[test]
fn silence_reads_zero() {
    for options in [ToolOptions::default(), calibration(94.0)] {
        let result = loudness_result(&vec![0.0; RATE as usize / 2], &options);
        assert!(
            result
                .loudness_sone
                .iter()
                .flatten()
                .all(|value| *value < 1e-6),
            "silence is not zero"
        );
    }
}

#[test]
fn an_input_component_outside_the_band_does_not_excite_retained_bands() {
    // The shared band limit applies to the model's input, not just to the rendered
    // ERB bands: a loud 60 Hz tone outside [2, 4] kHz must not read as loudness.
    let mut p = params(2048);
    p.freq_min_hz = 2_000.0;
    p.freq_max_hz = 4_000.0;
    let mono = tone(0.5, 60.0, 0.5);
    let result = match run(
        AnalyzerId::Loudness,
        &mono,
        RATE,
        &p,
        &ToolOptions::default(),
    )
    .expect("loudness")
    {
        AnalysisResult::Loudness(result) => result,
        other => panic!("unexpected result: {other:?}"),
    };
    assert!(
        result
            .loudness_sone
            .iter()
            .flatten()
            .all(|&value| value < 1e-3),
        "a 60 Hz component outside the 2–4 kHz band reads as loudness"
    );
}

#[test]
fn the_specific_loudness_bands_integrate_to_the_total() {
    let mono = tone(10f32.powf(-54.0 / 20.0), 1_000.0, 0.5);
    let options = calibration(94.0);
    let total = loudness_result(&mono, &options);
    let matrix = specific_result(&mono, &options);
    assert_eq!(matrix.values.len(), matrix.frames * matrix.bins);

    // The loudest frame, so both results describe the same moment.
    let frame = total
        .loudness_sone
        .iter()
        .enumerate()
        .filter_map(|(index, value)| value.map(|value| (index, value)))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(index, _)| index)
        .unwrap_or(0)
        .min(matrix.frames.saturating_sub(1));

    let edges = critical_band_edges(Scale::Erb, 0.0, RATE as f32 / 2.0);
    let mut sum = 0.0f64;
    let mut bark_sum = 0.0f64;
    for band in 0..matrix.bins {
        let value = f64::from(matrix.values[frame * matrix.bins + band]);
        // The values are sone per **Cam**: only a Cam-width integration reproduces N.
        sum += value * f64::from(cam(edges[band + 1]) - cam(edges[band]));
        bark_sum += value * f64::from(bark(edges[band + 1]) - bark(edges[band]));
    }
    let expected = f64::from(total.loudness_sone[frame].unwrap_or(0.0));
    assert!(
        (sum - expected).abs() <= expected.max(0.1) * 0.05,
        "Cam band sum {sum} does not approximate N = {expected}"
    );
    // The same values over Bark widths do not: the unit is sone/Cam, not sone/Bark.
    assert!(
        (bark_sum - expected).abs() > expected.max(0.1) * 0.05,
        "Bark band sum {bark_sum} also reproduces N = {expected}, so the Cam widths are not discriminated"
    );
}
