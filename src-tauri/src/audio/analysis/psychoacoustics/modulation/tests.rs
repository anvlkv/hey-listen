//! Tests for the roughness / fluctuation-strength pipeline, split out of
//! `modulation.rs` for the source-size budget.

use super::*;
use crate::audio::analysis::tests::{calibration, median, params, tone, RATE};

/// A 1 kHz tone modulated at `rate` Hz with `depth` (1 = 100 %), at −34 dBFS peak
/// so a 94 dB SPL calibration puts the carrier at 60 dB SPL.
fn modulated(rate: f32, depth: f32, seconds: f32) -> Vec<f32> {
    let amplitude = 10f32.powf(-34.0 / 20.0);
    let frames = (seconds * RATE as f32) as usize;
    (0..frames)
        .map(|index| {
            let time = index as f32 / RATE as f32;
            let carrier = (std::f32::consts::TAU * 1_000.0 * time).cos();
            amplitude * (1.0 + depth * (std::f32::consts::TAU * rate * time).cos()) * carrier
        })
        .collect()
}

fn value(weighting: &Weighting, signal: &[f32]) -> f32 {
    let (_, values) = modulate(
        signal,
        RATE,
        &params(2_048),
        weighting,
        calibration(94.0).calibration_db_spl(),
    );
    median(&values)
}

#[test]
fn a_seventy_hertz_modulation_reads_about_one_asper() {
    let asper = value(&roughness_weighting(), &modulated(70.0, 1.0, 0.5));
    assert!(
        (asper - 1.0).abs() <= 0.3,
        "70 Hz / 100 % AM reads {asper} asper, expected 1 ± 30%"
    );
}

#[test]
fn a_four_hertz_modulation_reads_about_one_vacil() {
    let vacil = value(&fluctuation_weighting(), &modulated(4.0, 1.0, 0.5));
    assert!(
        (vacil - 1.0).abs() <= 0.3,
        "4 Hz / 100 % AM reads {vacil} vacil, expected 1 ± 30%"
    );
}

#[test]
fn the_two_rates_separate() {
    let rapid = modulated(70.0, 1.0, 0.5);
    let slow = modulated(4.0, 1.0, 0.5);
    let rough_rapid = value(&roughness_weighting(), &rapid);
    let rough_slow = value(&roughness_weighting(), &slow);
    let fluct_rapid = value(&fluctuation_weighting(), &rapid);
    let fluct_slow = value(&fluctuation_weighting(), &slow);
    assert!(
        rough_rapid > 10.0 * rough_slow,
        "roughness: 70 Hz {rough_rapid} vs 4 Hz {rough_slow}"
    );
    assert!(
        fluct_slow > 10.0 * fluct_rapid,
        "fluctuation: 4 Hz {fluct_slow} vs 70 Hz {fluct_rapid}"
    );
}

#[test]
fn a_steady_carrier_reads_near_zero() {
    let steady = tone(10f32.powf(-34.0 / 20.0), 1_000.0, 0.5);
    let rough = value(&roughness_weighting(), &steady);
    let fluct = value(&fluctuation_weighting(), &steady);
    assert!(rough < 0.1, "steady carrier reads {rough} asper");
    assert!(fluct < 0.1, "steady carrier reads {fluct} vacil");
}

#[test]
fn a_deeper_modulation_reads_higher() {
    let shallow = value(&roughness_weighting(), &modulated(70.0, 0.25, 0.5));
    let deep = value(&roughness_weighting(), &modulated(70.0, 1.0, 0.5));
    assert!(deep > shallow, "deep {deep} is not above shallow {shallow}");
}

#[test]
fn the_level_weight_follows_the_calibration() {
    // Uncalibrated runs are relative; a calibrated run 20 dB down is quieter.
    let signal = modulated(70.0, 1.0, 0.5);
    let (_, relative) = modulate(&signal, RATE, &params(2_048), &roughness_weighting(), 0.0);
    let (_, weighted) = modulate(&signal, RATE, &params(2_048), &roughness_weighting(), 74.0);
    assert!(median(&relative) > 3.0 * median(&weighted));
}
