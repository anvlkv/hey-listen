//! The `loudness` / `specificLoudness` tools through the shared dispatcher (M27).

use super::{calibration, median, params, tone, RATE};
use crate::audio::analysis::psychoacoustics::bands::critical_band_edges;
use crate::audio::analysis::psychoacoustics::scales::{cam, Scale};
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
    for band in 0..matrix.bins {
        let value = matrix.values[frame * matrix.bins + band];
        let width = f64::from(cam(edges[band + 1]) - cam(edges[band]));
        sum += f64::from(value) * width;
    }
    let expected = f64::from(total.loudness_sone[frame].unwrap_or(0.0));
    assert!(
        (sum - expected).abs() <= expected.max(0.1) * 0.05,
        "band sum {sum} does not approximate N = {expected}"
    );
}
