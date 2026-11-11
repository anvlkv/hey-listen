//! Tests for the roughness / fluctuation-strength pipeline, split out of
//! `modulation.rs` for the source-size budget.

use super::*;
use crate::audio::analysis::tests::{calibration, median, params, tone, RATE};

mod rates;

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
    let modulation = modulate(
        signal,
        RATE,
        &params(2_048),
        weighting,
        calibration(94.0).calibration_db_spl(),
    );
    median(&modulation.values)
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
fn a_steady_low_carrier_does_not_read_as_roughness() {
    // Full-wave rectification doubles a 35 Hz carrier to 70 Hz — the roughness
    // filter's own rate. A steady carrier must still read about 0, both in the band
    // that holds it and over the full range (whose skirts carry only leakage).
    let signal = tone(0.1, 35.0, 3.0);
    for ((min_hz, max_hz), tolerance) in [((20.0, 60.0), 0.1), ((0.0, 0.0), 0.15)] {
        let mut p = params(2_048);
        p.freq_min_hz = min_hz;
        p.freq_max_hz = max_hz;
        let modulation = modulate(&signal, RATE, &p, &roughness_weighting(), 0.0);
        let measured = median(&modulation.values);
        assert!(
            measured < tolerance,
            "steady 35 Hz carrier over [{min_hz}, {max_hz}] Hz reads {measured} asper"
        );
    }
}

#[test]
fn a_carrier_outside_the_selected_range_is_not_modulation() {
    // A steady carrier far below the selection reaches those bands only through their
    // finite-rejection skirts. That leakage is gated out rather than normalized by the
    // band's own mean into apparent roughness.
    let signal = tone(0.1, 35.0, 3.0);
    let mut p = params(2_048);
    p.freq_min_hz = 2_000.0;
    p.freq_max_hz = 2_100.0;
    let modulation = modulate(&signal, RATE, &p, &roughness_weighting(), 0.0);
    assert!(
        modulation
            .values
            .iter()
            .flatten()
            .all(|&value| value < 0.05),
        "out-of-band carrier leaks {} asper",
        median(&modulation.values)
    );
}

#[test]
fn the_envelope_rate_does_not_depend_on_the_selection_length() {
    // Decimation is a function of the sample rate alone: an hour-long selection keeps
    // the same envelope rate — and so the same measurable modulation bandwidth — as a
    // short one, instead of being widened until 70 Hz aliases down to a few hertz.
    for rate in [8_000.0, 44_100.0, 48_000.0, 96_000.0] {
        let decim = decimation(rate) as f64;
        let envelope_rate = rate / decim;
        assert!(
            (envelope_rate - ENVELOPE_RATE_HZ).abs() <= ENVELOPE_RATE_HZ / 12.0,
            "{rate} Hz decimates ×{decim} to {envelope_rate} Hz"
        );
    }
}

#[test]
fn a_long_selection_measures_the_same_modulation() {
    // The same stimulus over very different durations must give the same rate's worth
    // of roughness; the frame value may not drift with the selection length.
    let short = value(&roughness_weighting(), &modulated(70.0, 1.0, 0.5));
    let long = value(&roughness_weighting(), &modulated(70.0, 1.0, 10.0));
    assert!(
        (long - short).abs() <= 0.3 * short.max(1.0),
        "0.5 s reads {short} asper, 10 s reads {long}"
    );
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
    let relative = modulate(&signal, RATE, &params(2_048), &roughness_weighting(), 0.0);
    let weighted = modulate(&signal, RATE, &params(2_048), &roughness_weighting(), 74.0);
    assert!(median(&relative.values) > 3.0 * median(&weighted.values));
}

#[test]
fn the_band_columns_sum_to_the_frame_value() {
    // The contribution grid is post-`scale`/`gain`, so a frame's columns reproduce the
    // scalar exactly; that also pins the scalar's arithmetic.
    let modulation = modulate(
        &modulated(70.0, 1.0, 0.5),
        RATE,
        &params(2_048),
        &roughness_weighting(),
        calibration(94.0).calibration_db_spl(),
    );
    let bins = modulation.bands.len();
    assert!(bins > 0, "no critical bands");
    assert_eq!(
        modulation.contributions.len(),
        modulation.values.len() * bins
    );
    let mut measured = 0;
    for (frame, value) in modulation.values.iter().enumerate() {
        let Some(value) = value else { continue };
        let sum: f32 = modulation.contributions[frame * bins..(frame + 1) * bins]
            .iter()
            .sum();
        assert!(
            (sum - value).abs() <= 1e-3 * value.abs().max(1.0),
            "frame {frame}: columns sum to {sum}, scalar is {value}"
        );
        measured += 1;
    }
    assert!(measured > 0, "no frame was measured");
    assert!(
        modulation.bands.iter().all(|band| band.is_finite()),
        "a band centre is not finite"
    );

    // A gap frame is an all-zero row, not a missing one: silence must not invent
    // contribution anywhere.
    let silent = modulate(
        &vec![0.0; RATE as usize / 2],
        RATE,
        &params(2_048),
        &roughness_weighting(),
        calibration(94.0).calibration_db_spl(),
    );
    assert!(
        silent.values.iter().all(Option::is_none),
        "silence measured a frame"
    );
    assert_eq!(
        silent.contributions.len(),
        silent.values.len() * silent.bands.len(),
        "a gap row is missing from the grid"
    );
    assert!(
        silent.contributions.iter().all(|&value| value == 0.0),
        "a gap frame carries a contribution"
    );
}

#[test]
fn the_level_weight_only_falls_below_the_reference() {
    // Documented one-sided behaviour: at or above the reference level the factor is a
    // flat 1, so an amplitude sweep above it is not a roughness-versus-level curve.
    assert_eq!(level_weight(0.0, 57.0), 1.0);
    assert_eq!(level_weight(20.0, 57.0), 1.0);
    assert_eq!(level_weight(0.0, 0.0), 1.0);
    assert!((level_weight(-20.0, 57.0) - 0.1).abs() < 1e-9);
}
