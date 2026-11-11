//! Tests for the masking model, split out of `masking.rs` for the source-size
//! budget.

use super::*;

/// 100 Hz-spaced bins from 100 Hz to 5 kHz.
fn freqs() -> Vec<f32> {
    (1..=50).map(|bin| bin as f32 * 100.0).collect()
}

#[test]
fn a_residual_masker_sums_its_band_and_centres_on_power() {
    // Three unclaimed lines inside one 0.5-Bark band (floor(z / 0.5) == 2).
    let positions = [1.0f32, 1.1, 1.2];
    let levels = [-10.0f32; 3];
    let claimed = [false; 3];
    let maskers = residual_maskers(&positions, &levels, &claimed);
    assert_eq!(maskers.len(), 1, "the three lines did not share one band");
    let masker = &maskers[0];
    // 3 × 10^-1 power = 0.3 → −5.229 dB.
    let expected_level = 10.0 * 0.3f32.log10();
    assert!(
        (masker.level - expected_level).abs() < 1e-4,
        "residual level {} ≠ summed band {expected_level}",
        masker.level
    );
    // Power-weighted Bark centre: (1.0 + 1.1 + 1.2) / 3.
    assert!((masker.z - 1.1).abs() < 1e-6, "centre {} ≠ 1.1", masker.z);
}

#[test]
fn the_global_threshold_never_falls_below_the_threshold_in_quiet() {
    let freqs = freqs();
    let levels = vec![-20.0f32; freqs.len()];
    let model = masking_thresholds(&freqs, &levels, true);
    for (index, (&tq, &tg)) in model
        .threshold_quiet_db
        .iter()
        .zip(&model.global_mask_db)
        .enumerate()
    {
        assert!(tg >= tq, "bin {index}: Tg {tg} < Tq {tq}");
    }
}

#[test]
fn a_clear_peak_is_tonal_and_a_flat_spectrum_is_not() {
    let freqs = freqs();
    let flat = vec![-60.0f32; freqs.len()];
    assert_eq!(tonality_profile(&freqs, &flat).0, 0.0);

    let mut peaked = flat;
    let index = freqs.iter().position(|&hz| hz == 1_000.0).expect("1 kHz");
    peaked[index] = -10.0;
    let fraction = tonality_profile(&freqs, &peaked).0;
    assert!(
        fraction > 0.9,
        "a single dominant line is {fraction:.3} tonal, expected > 0.9"
    );
}

#[test]
fn a_tonal_masker_sums_its_main_lobe() {
    // Peak at -10 dB with half-amplitude neighbours: 1 + 0.25 + 0.25 power,
    // ≈ +1.76 dB, so the component outranks its own peak bin.
    let mut levels = vec![-120.0f32; 9];
    levels[4] = -10.0;
    levels[3] = -16.0206;
    levels[5] = -16.0206;
    let (components, claimed) = detect_tonal(&[0.0; 9], &levels);
    assert_eq!(components.len(), 1);
    assert_eq!(components[0].0, 4);
    assert!(claimed[3] && claimed[5], "main lobe not claimed");
    let level = 10.0 * components[0].1.log10();
    let expected = -10.0 + 10.0 * 1.5f64.log10();
    assert!((level - expected).abs() < 0.05, "{level} vs {expected}");
}

#[test]
fn the_masking_function_is_bounded_to_its_piecewise_range() {
    assert!(masking_function(-3.5, 60.0).is_infinite());
    assert!(masking_function(8.0, 60.0).is_infinite());
    assert!(masking_function(0.0, 60.0).is_finite());
    assert!(masking_function(2.0, 60.0) < masking_function(0.5, 60.0));
}

#[test]
fn the_masker_list_names_its_tonal_and_residual_sources() {
    // A loud line plus a floor-level background: the line is the tonal masker and the
    // unclaimed floor bins become the residual (non-tonal) ones.
    let freqs = freqs();
    let mut levels = vec![-110.0f32; freqs.len()];
    levels[9] = -10.0;
    let model = masking_thresholds(&freqs, &levels, true);
    assert!(!model.maskers.is_empty(), "no maskers were reported");
    assert!(model.maskers.iter().any(|masker| masker.tonal));
    assert!(model.maskers.iter().any(|masker| !masker.tonal));
    for masker in &model.maskers {
        assert!(
            masker.hz.is_finite() && masker.hz > 0.0 && masker.level_db.is_finite(),
            "bad masker: {masker:?}"
        );
    }
}

#[test]
fn a_tonal_prominence_marks_only_the_detected_peaks() {
    let freqs = freqs();
    let mut levels = vec![-80.0f32; freqs.len()];
    let peak = freqs.iter().position(|&hz| hz == 2_000.0).expect("2 kHz");
    levels[peak] = -10.0;
    let prominence = tonality_profile(&freqs, &levels).1;
    assert_eq!(prominence.len(), freqs.len());
    assert!(
        prominence[peak] > 40.0,
        "the peak's prominence is {}",
        prominence[peak]
    );
    assert!(
        prominence
            .iter()
            .enumerate()
            .all(|(index, &value)| index == peak || value == 0.0),
        "a non-peak line carries a non-zero prominence: {prominence:?}"
    );
}
