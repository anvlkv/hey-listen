//! The band × rate matrix tests (M36), split out of `tests.rs` for the budget.

use super::super::*;
use super::modulated;
use crate::audio::analysis::tests::{calibration, params, tone, RATE};

/// The loudest band's rate spectrum, summed over the frames: the rate (Hz) of its peak
/// and that peak's total depth.
///
/// Aggregating over the frames makes the assertion independent of which of the bands
/// around the carrier happens to sit highest in one frame.
fn rate_peak(modulation: &Modulation) -> (f32, f32) {
    let bands = modulation.bands.len();
    let rates = modulation.rates.len();
    let frames = modulation.values.len();
    assert_eq!(
        modulation.rate_values.len(),
        frames * bands * rates,
        "the rate matrix is not `frames * bands * rates`"
    );
    let mut totals = vec![0.0f64; bands * rates];
    for row in modulation.rate_values.chunks_exact(bands * rates) {
        for (total, &value) in totals.iter_mut().zip(row) {
            *total += f64::from(value);
        }
    }
    let compare = |a: &f64, b: &f64| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal);
    let sums: Vec<f64> = (0..bands)
        .map(|band| totals[band * rates..(band + 1) * rates].iter().sum())
        .collect();
    let band = (0..bands)
        .max_by(|&a, &b| compare(&sums[a], &sums[b]))
        .expect("a band");
    let row = &totals[band * rates..(band + 1) * rates];
    let (index, &peak) = row
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| compare(a, b))
        .expect("a rate");
    (modulation.rates[index], peak as f32)
}

#[test]
fn the_rate_matrix_peaks_at_the_modulation_rate() {
    // The band × rate matrix is the third axis the scalar collapses: a 70 Hz AM tone must
    // peak on the roughness region's rate, a 4 Hz AM tone on fluctuation's. The rate axis
    // is in Hz, so a wrong axis (bin index, or the tool's target rate repeated) fails.
    let rapid = modulate(
        &modulated(70.0, 1.0, 0.5),
        RATE,
        &params(2_048),
        &roughness_weighting(),
        0.0,
    );
    let (rate, depth) = rate_peak(&rapid);
    assert!(
        (rate - 70.0).abs() <= 0.25 * 70.0,
        "70 Hz AM peaks at {rate} Hz"
    );
    assert!(depth > 0.0, "the 70 Hz peak has no depth");

    let slow = modulate(
        &modulated(4.0, 1.0, 0.5),
        RATE,
        &params(2_048),
        &fluctuation_weighting(),
        0.0,
    );
    let (rate, depth) = rate_peak(&slow);
    assert!(
        (rate - 4.0).abs() <= 0.25 * 4.0,
        "4 Hz AM peaks at {rate} Hz"
    );
    assert!(depth > 0.0, "the 4 Hz peak has no depth");
}

#[test]
fn the_rate_matrix_has_the_documented_shape() {
    let modulation = modulate(
        &modulated(70.0, 1.0, 0.5),
        RATE,
        &params(2_048),
        &roughness_weighting(),
        0.0,
    );
    let (frames, bands, rates) = (
        modulation.values.len(),
        modulation.bands.len(),
        modulation.rates.len(),
    );
    assert!(frames > 0 && bands > 0 && rates > 0, "an empty rate matrix");
    assert_eq!(modulation.rate_values.len(), frames * bands * rates);
    assert!(
        modulation.rates.windows(2).all(|pair| pair[1] > pair[0]),
        "the rate axis is not increasing"
    );
    assert!(modulation.rates.first().is_some_and(|&hz| hz >= 1.0));
    assert!(modulation.rates.last().is_some_and(|&hz| hz <= 100.0));
    assert!(modulation
        .rate_values
        .iter()
        .all(|value| value.is_finite() && *value >= 0.0));
}

#[test]
fn a_steady_carrier_has_no_modulation_at_the_measured_rate() {
    // The depth removes the window mean, so the DC term is exactly zero. A steady carrier
    // can still show the critical-band filterbank's own small envelope ripple at other
    // rates (the single-bin estimate is approximate off its exact bin); what it must not
    // do is modulate at the rate the tool measures (roughness: 70 Hz). The first frames
    // are skipped while the filters settle.
    let steady = tone(10f32.powf(-34.0 / 20.0), 1_000.0, 0.5);
    let modulation = modulate(&steady, RATE, &params(2_048), &roughness_weighting(), 0.0);
    let bands = modulation.bands.len();
    let rates = modulation.rates.len();
    let stride = bands * rates;
    let target = modulation
        .rates
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| (*a - 70.0).abs().total_cmp(&(*b - 70.0).abs()))
        .map(|(index, _)| index)
        .expect("a rate");
    let at_target = modulation
        .rate_values
        .chunks_exact(stride)
        .skip(10)
        .map(|frame| {
            frame
                .iter()
                .skip(target)
                .step_by(rates)
                .copied()
                .fold(0.0f32, f32::max)
        })
        .fold(0.0f32, f32::max);
    assert!(
        at_target < 0.15,
        "a steady carrier modulates at {:.1} Hz by {at_target}",
        modulation.rates[target]
    );
}

#[test]
fn silence_has_a_zero_rate_matrix() {
    // A gap frame is a zero row on every axis, never a NaN: a band with no measurable
    // mean returns before the DFT (see `RateCells::collect`).
    let silent = modulate(
        &vec![0.0; RATE as usize / 2],
        RATE,
        &params(2_048),
        &roughness_weighting(),
        calibration(94.0).calibration_db_spl(),
    );
    let stride = silent.bands.len() * silent.rates.len();
    assert!(stride > 0, "the rate matrix has an empty axis");
    assert_eq!(silent.rate_values.len(), silent.values.len() * stride);
    assert!(silent.values.iter().all(Option::is_none));
    assert!(silent.rate_values.iter().all(|&value| value == 0.0));
}

#[test]
fn a_weighting_without_rate_collection_leaves_the_matrix_empty() {
    let weighting = Weighting {
        collect_rates: false,
        ..roughness_weighting()
    };
    let modulation = modulate(
        &modulated(70.0, 1.0, 0.5),
        RATE,
        &params(2_048),
        &weighting,
        0.0,
    );
    assert!(modulation.rates.is_empty());
    assert!(modulation.rate_values.is_empty());
    // The scalar and its per-band grid are unaffected by the flag.
    assert_eq!(
        modulation.contributions.len(),
        modulation.values.len() * modulation.bands.len()
    );
}
