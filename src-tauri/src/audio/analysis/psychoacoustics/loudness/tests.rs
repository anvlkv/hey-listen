//! Unit tests for the Moore–Glasberg stationary loudness model (M27).

use super::*;
use crate::audio::analysis::psychoacoustics::bands::critical_band_edges;
use crate::audio::analysis::psychoacoustics::scales::{cam, Scale};

/// A single sinusoidal component at `hz` with band level `db_spl`.
fn tone(hz: f32, db_spl: f32) -> FrameLoudness {
    analyze_frame(&[hz], &[db_spl])
}

#[test]
fn a_calibrated_one_khz_tone_at_40_db_spl_is_about_one_sone() {
    // The sone's definition: a 1 kHz tone at 40 dB SPL, binaural free field.
    let frame = tone(1_000.0, 40.0);
    assert!(
        (frame.sone - 1.0).abs() <= 0.2,
        "N = {} sone, expected 1 ± 20%",
        frame.sone
    );
    assert!(
        (frame.phon - 40.0).abs() <= 2.0,
        "LN = {} phon, expected ~40",
        frame.phon
    );
}

#[test]
fn a_louder_tone_has_a_higher_loudness() {
    let quiet = tone(1_000.0, 40.0);
    let loud = tone(1_000.0, 60.0);
    assert!(
        loud.sone > quiet.sone,
        "60 dB SPL = {} sone is not louder than 40 dB SPL = {} sone",
        loud.sone,
        quiet.sone
    );
    assert!(loud.phon > quiet.phon);
}

#[test]
fn silence_floors_at_zero() {
    for frame in [
        analyze_frame(&[], &[]),
        analyze_frame(&[1_000.0], &[f32::NEG_INFINITY]),
        tone(1_000.0, -120.0),
    ] {
        assert!(frame.sone < 1e-6, "silence reads {} sone", frame.sone);
        assert!(frame.phon < 1e-6, "silence reads {} phon", frame.phon);
        assert!(frame.specific.iter().all(|&value| value < 1e-6));
    }
}

#[test]
fn components_outside_the_audible_range_are_ignored() {
    let frame = analyze_frame(&[5.0, 30_000.0], &[90.0, 90.0]);
    assert_eq!(frame.sone, 0.0);
}

#[test]
fn a_partial_cell_integrates_the_linear_ramp() {
    // Samples 1 and 0 at the first two grid points (1.8 and 1.9 Cam); averaged over
    // [1.8, 1.85] the linear ramp's mean is (1 + 0.5) / 2.
    let grid = grid();
    let mut pattern = vec![0.0f32; grid.cam.len()];
    pattern[0] = 1.0;
    let mean = band_mean(&pattern, 1.8, 1.85);
    assert!(
        (mean - 0.75).abs() < 1e-5,
        "ramp mean over a partial cell is {mean}, expected 0.75"
    );
}

#[test]
fn the_total_is_the_trapezoid_integral_of_the_specific_loudness() {
    let frame = tone(1_000.0, 60.0);
    let values: Vec<f64> = frame
        .specific
        .iter()
        .map(|&value| f64::from(value))
        .collect();
    let trapezoid = grid_integral(&values, I_STEP);
    let expected = f64::from(frame.sone);
    assert!(
        (trapezoid - expected).abs() <= expected.max(0.1) * 1e-4,
        "trapezoid {trapezoid} does not reproduce N = {expected}"
    );
}

#[test]
fn integrating_the_specific_loudness_reproduces_the_total() {
    let frame = tone(1_000.0, 40.0);
    let edges = critical_band_edges(Scale::Erb, 0.0, 24_000.0);
    let mut total = 0.0f64;
    for pair in edges.windows(2) {
        // The density is sone per **Cam**, so the span is measured on the ERB axis.
        let (lo, hi) = (cam(pair[0]), cam(pair[1]));
        total += f64::from(band_mean(&frame.specific, lo, hi)) * f64::from(hi - lo);
    }
    let tolerance = f64::from(frame.sone.max(0.1)) * 0.05;
    assert!(
        (total - f64::from(frame.sone)).abs() <= tolerance,
        "Cam band sum {total} does not reproduce N = {} sone",
        frame.sone
    );
}

#[test]
fn a_band_outside_the_model_is_empty() {
    let frame = tone(1_000.0, 40.0);
    assert_eq!(band_mean(&frame.specific, 0.0, 0.5), 0.0);
    assert_eq!(band_mean(&frame.specific, 50.0, 60.0), 0.0);
    assert_eq!(band_mean(&frame.specific, 5.0, 5.0), 0.0);
}

#[test]
fn sone_to_phon_matches_the_conventional_curve() {
    assert_eq!(sone_to_phon(0.0), 0.0);
    assert!((sone_to_phon(1.0) - 40.0).abs() < 1e-6);
    // 4 sone is 60 phon (a 20 phon step doubles the loudness).
    assert!((sone_to_phon(4.0) - 60.0).abs() < 1e-4);
    // Below one sone the power law applies.
    assert!((sone_to_phon(0.25) - 40.0 * 0.25f32.powf(0.35)).abs() < 1e-4);
}
