//! The `sharpness` analyzer (M28): perceived sharpness from the M27
//! specific-loudness distribution.
//!
//! Perceived sharpness weights the specific-loudness distribution `N'(z)` toward its
//! high-frequency part, so a bright, hissy or metallic sound scores higher than a dull,
//! low-frequency one at the same loudness. Per frame:
//!
//! ```text
//! S = k * Σ N'(z_i) g(z_i) z_i / Σ N'(z_i)
//! g(z) = 1                                  (z ≤ 15.8 Bark)
//!      = 0.15 e^(0.42 (z − 15.8)) + 0.85    (z > 15.8 Bark)
//! ```
//!
//! Our loudness model runs on the ERB (Cam) axis, so each ERB band centre `f_i` is
//! mapped to `z_i = bark(f_i)` first. `k` is chosen so a 1 kHz reference tone reads
//! about 1 acum. This is **perceived sharpness** computed from the Moore–Glasberg
//! specific-loudness distribution with a high-frequency weighting — a documented
//! approximation, not a conformance claim for any standard.

use super::super::psychoacoustics::scales::bark;
use super::super::support::frame_times;
use super::super::{AnalysisError, CalibratedSeriesResult, SharedParams, ToolOptions};

use super::loudness::specific_loudness;

/// The reference constant: a 1 kHz tone reads about 1 acum.
const K_ACUM: f64 = 0.11;
/// Above this Bark position the high-frequency weighting rises.
const BARK_KNEE: f64 = 15.8;

/// The high-frequency weighting `g(z)`.
fn weight(z: f64) -> f64 {
    if z <= BARK_KNEE {
        1.0
    } else {
        0.15 * (0.42 * (z - BARK_KNEE)).exp() + 0.85
    }
}

/// Sharpness (acum) of one frame's `N'(z)` row, or `None` when it carries no loudness.
fn frame_sharpness(row: &[f32], positions: &[(f64, f64)]) -> Option<f32> {
    let mut numerator = 0.0f64;
    let mut denominator = 0.0f64;
    for (&loudness, &(z, g)) in row.iter().zip(positions) {
        let loudness = f64::from(loudness);
        if !loudness.is_finite() || loudness <= 0.0 {
            continue;
        }
        numerator += loudness * g * z;
        denominator += loudness;
    }
    (denominator > 0.0).then(|| (K_ACUM * numerator / denominator) as f32)
}

/// Perceived sharpness per STFT frame, in acum.
///
/// Reuses the `specificLoudness` computation (its ERB band cap keeps the result
/// bounded), so the values share its model and calibration: `calibrationDbSpl` at `0`
/// is uncalibrated, while a positive value is the dB SPL of a full-scale sine.
pub(super) fn sharpness(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<CalibratedSeriesResult, AnalysisError> {
    let calibration = options.calibration_db_spl();
    let matrix = specific_loudness(mono, sample_rate, params, options)?;

    // Each ERB band centre on the Bark axis, with its high-frequency weight.
    let positions: Vec<(f64, f64)> = matrix
        .bands
        .iter()
        .map(|&hz| {
            let z = f64::from(bark(hz));
            (z, weight(z))
        })
        .collect();
    let bins = matrix.bins;
    let values: Vec<Option<f32>> = if bins == 0 {
        vec![None; matrix.frames]
    } else {
        matrix
            .values
            .chunks_exact(bins)
            .take(matrix.frames)
            .map(|row| frame_sharpness(row, &positions))
            .collect()
    };

    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
    }
    Ok(CalibratedSeriesResult {
        sample_rate,
        hop_size: matrix.hop_size,
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        times: frame_times(values.len(), matrix.hop_size, sample_rate),
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        calibrated: calibration > 0.0,
        calibration_db_spl: calibration,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::tests::{calibration, median, params, tone, RATE};

    #[test]
    fn a_calibrated_one_khz_tone_reads_about_one_acum() {
        // A full-scale sine is 94 dB SPL, so −34 dBFS is 60 dB SPL.
        let mono = tone(10f32.powf(-34.0 / 20.0), 1_000.0, 0.5);
        let result = sharpness(&mono, RATE, &params(2_048), &calibration(94.0)).expect("sharpness");
        assert!(result.calibrated);
        assert_eq!(result.calibration_db_spl, 94.0);
        let acum = median(&result.values);
        assert!(
            (acum - 1.0).abs() <= 0.15,
            "calibrated 1 kHz / 60 dB SPL reads {acum} acum, expected 1 ± 15%"
        );
    }

    #[test]
    fn a_bright_tone_reads_higher_than_a_dull_one_at_equal_level() {
        let amplitude = 10f32.powf(-34.0 / 20.0);
        let dull = sharpness(
            &tone(amplitude, 500.0, 0.5),
            RATE,
            &params(2_048),
            &calibration(94.0),
        )
        .expect("dull");
        let bright = sharpness(
            &tone(amplitude, 4_000.0, 0.5),
            RATE,
            &params(2_048),
            &calibration(94.0),
        )
        .expect("bright");
        assert!(
            median(&bright.values) > median(&dull.values),
            "4 kHz ({} acum) is not sharper than 500 Hz ({} acum)",
            median(&bright.values),
            median(&dull.values)
        );
    }

    #[test]
    fn an_uncalibrated_run_is_labelled() {
        let result = sharpness(
            &tone(0.5, 1_000.0, 0.5),
            RATE,
            &params(2_048),
            &ToolOptions::default(),
        )
        .expect("sharpness");
        assert!(!result.calibrated);
        assert_eq!(result.calibration_db_spl, 0.0);
        assert_eq!(result.values.len(), result.times.len());
    }
}
