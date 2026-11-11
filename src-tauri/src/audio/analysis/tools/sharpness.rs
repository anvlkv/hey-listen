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
//! approximation with its own `k`, **not** the DIN 45692 model or a conformance
//! claim for any standard.

use super::super::psychoacoustics::scales::bark;
use super::super::support::frame_times;
use super::super::{
    AnalysisError, CalibratedSeriesResult, Contribution, SharedParams, ToolOptions,
};

use super::loudness::specific_loudness;
use super::shared::series_extents;

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
///
/// `out` receives each ERB band's `N'(z_b) · g(z_b) · z_b`, so a frame's cells sum to
/// the numerator of `K_ACUM · Σ / Σ` (see [`sharpness`]).
fn frame_sharpness(row: &[f32], positions: &[(f64, f64)], out: &mut [f32]) -> Option<f32> {
    let mut numerator = 0.0f64;
    let mut denominator = 0.0f64;
    for ((&loudness, &(z, g)), cell) in row.iter().zip(positions).zip(out.iter_mut()) {
        let loudness = f64::from(loudness);
        let term = if !loudness.is_finite() || loudness <= 0.0 {
            0.0
        } else {
            numerator += loudness * g * z;
            denominator += loudness;
            loudness * g * z
        };
        *cell = term as f32;
    }
    (denominator > 0.0).then(|| (K_ACUM * numerator / denominator) as f32)
}

/// Perceived sharpness per STFT frame, in acum.
///
/// Reuses the `specificLoudness` computation (its ERB band cap keeps the result
/// bounded), so the values share its model and calibration: `calibrationDbSpl` at `0`
/// is uncalibrated, while a positive value is the dB SPL of a full-scale sine.
///
/// The attached [`Contribution`] grid decomposes the scalar per ERB band (M36): a cell
/// is `N'(z_b) · g(z_b) · z_b` — specific loudness × high-frequency weight × Bark
/// position — in `sone/Cam` terms (`z_b = bark(bands[b])`). One frame's cells therefore
/// **sum to the numerator**: `S = K_ACUM · Σ_b cell_b / Σ_b N'_b`, where the denominator
/// is that frame's total specific loudness (the same frame's row sum in
/// `specificLoudness`). The grid is the numerator decomposition, not a standalone
/// reconstruction of `S`.
pub(super) fn sharpness(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<CalibratedSeriesResult, AnalysisError> {
    let calibration = options.calibration_db_spl();
    let matrix = specific_loudness(mono, sample_rate, params, options)?;

    // Each ERB band centre on the Bark axis, with its high-frequency weight.
    let bins = matrix.bins.min(matrix.bands.len());
    let bands: Vec<f32> = matrix.bands[..bins].to_vec();
    let positions: Vec<(f64, f64)> = bands
        .iter()
        .map(|&hz| {
            let z = f64::from(bark(hz));
            (z, weight(z))
        })
        .collect();
    let mut contributions: Vec<f32> = Vec::with_capacity(matrix.frames * bins);
    let values: Vec<Option<f32>> = if bins == 0 || matrix.bins == 0 {
        vec![None; matrix.frames]
    } else {
        let mut cells = vec![0.0f32; bins];
        let mut values = Vec::with_capacity(matrix.frames);
        for row in matrix.values.chunks_exact(matrix.bins).take(matrix.frames) {
            values.push(frame_sharpness(&row[..bins], &positions, &mut cells));
            contributions.extend_from_slice(&cells);
        }
        values
    };

    let (min_value, max_value) = series_extents(&values);
    let times = frame_times(values.len(), matrix.hop_size, sample_rate);
    Ok(CalibratedSeriesResult {
        sample_rate,
        hop_size: matrix.hop_size,
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        times: times.clone(),
        values,
        min_value,
        max_value,
        calibrated: calibration > 0.0,
        calibration_db_spl: calibration,
        contribution: Some(Contribution {
            frames: times.len(),
            bins,
            times,
            bands,
            values: contributions,
            label: "sharpness weight".to_string(),
            unit: Some("sone/Cam".to_string()),
        }),
        rate_contribution: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::tests::{calibration, median, params, tone, RATE};
    use crate::audio::analysis::{run, AnalysisResult};
    use crate::audio::analyzers::AnalyzerId;

    /// Total loudness of `mono` in sones through the dispatcher (median frame).
    fn total_sone(mono: &[f32]) -> f64 {
        match run(
            AnalyzerId::Loudness,
            mono,
            RATE,
            &params(2_048),
            &calibration(94.0),
        )
        .expect("loudness")
        {
            AnalysisResult::Loudness(result) => f64::from(median(&result.loudness_sone)),
            other => panic!("unexpected result: {other:?}"),
        }
    }

    /// The peak amplitude at which a `hz` tone reads `target` sones.
    fn amplitude_for_loudness(hz: f32, target: f64, start: f32) -> f32 {
        let mut amplitude = start;
        // Around 60 dB SPL a sone grows roughly as pressure^0.6, so this converges in
        // a few steps.
        for _ in 0..8 {
            let sone = total_sone(&tone(amplitude, hz, 0.5));
            if !(sone.is_finite() && sone > 0.0) {
                amplitude *= 2.0;
                continue;
            }
            amplitude = (f64::from(amplitude) * (target / sone).powf(1.0 / 0.6)) as f32;
        }
        amplitude
    }

    fn acum(mono: &[f32]) -> f32 {
        median(
            &sharpness(mono, RATE, &params(2_048), &calibration(94.0))
                .expect("sharpness")
                .values,
        )
    }

    #[test]
    fn a_calibrated_one_khz_tone_reads_about_one_acum() {
        // A full-scale sine is 94 dB SPL, so −34 dBFS is 60 dB SPL.
        let mono = tone(10f32.powf(-34.0 / 20.0), 1_000.0, 0.5);
        let result = sharpness(&mono, RATE, &params(2_048), &calibration(94.0)).expect("sharpness");
        assert!(result.calibrated);
        assert_eq!(result.calibration_db_spl, 94.0);
        // Only the modulation tools collect a band × rate matrix (M36).
        assert!(result.rate_contribution.is_none());
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
    fn a_bright_tone_is_sharper_at_equal_loudness() {
        // 500 Hz and 4 kHz at 60 dB SPL are not equally loud, so lift the bright tone
        // until the model gives it the dull tone's total loudness. Equal level alone
        // does not isolate the sharpness weighting from the loudness difference.
        let dull = tone(10f32.powf(-34.0 / 20.0), 500.0, 0.5);
        let target = total_sone(&dull);
        let amplitude = amplitude_for_loudness(4_000.0, target, 10f32.powf(-34.0 / 20.0));
        let bright = tone(amplitude, 4_000.0, 0.5);
        let matched = total_sone(&bright);
        assert!(
            (matched - target).abs() <= target * 0.05,
            "4 kHz at amplitude {amplitude} reads {matched} sone, not the dull tone's {target}"
        );
        let (dull_acum, bright_acum) = (acum(&dull), acum(&bright));
        assert!(
            bright_acum > dull_acum,
            "4 kHz ({bright_acum} acum) is not sharper than 500 Hz ({dull_acum} acum) at equal loudness"
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

    #[test]
    fn the_contribution_grid_decomposes_the_numerator() {
        let mono = tone(10f32.powf(-34.0 / 20.0), 4_000.0, 0.5);
        let result = sharpness(&mono, RATE, &params(2_048), &calibration(94.0)).expect("sharpness");
        let contribution = result.contribution.as_ref().expect("a contribution grid");
        contribution.assert_consistent();
        assert_eq!(contribution.frames, result.values.len());
        assert_eq!(
            contribution.times, result.times,
            "grid times drift from the track"
        );
        assert_eq!(contribution.label, "sharpness weight");
        assert_eq!(contribution.unit.as_deref(), Some("sone/Cam"));
        assert!(
            contribution.values.iter().any(|&value| value > 0.0),
            "every band contributed nothing"
        );

        // The cells must be the numerator, not merely well-shaped: for every measured
        // frame, Σ cells = S · Σ N' / K_ACUM, using the same specific-loudness row the
        // tool integrated. Dropping the `g` or `z` weight would fail this.
        let matrix = specific_loudness(&mono, RATE, &params(2_048), &calibration(94.0))
            .expect("specific loudness");
        assert_eq!(matrix.frames, contribution.frames);
        assert_eq!(matrix.bins, contribution.bins);
        let mut measured = 0;
        for (frame, value) in result.values.iter().enumerate() {
            let Some(sharpness) = value else { continue };
            let row = &matrix.values[frame * matrix.bins..(frame + 1) * matrix.bins];
            let total_np: f64 = row.iter().map(|&loudness| f64::from(loudness)).sum();
            if total_np <= 0.0 {
                continue;
            }
            let cells: f64 = contribution.values
                [frame * contribution.bins..(frame + 1) * contribution.bins]
                .iter()
                .map(|&cell| f64::from(cell))
                .sum();
            let expected = f64::from(*sharpness) * total_np / K_ACUM;
            assert!(
                (cells - expected).abs() <= 1e-3 * expected.max(1.0),
                "frame {frame}: cells sum to {cells}, expected S·ΣN'/K = {expected}"
            );
            measured += 1;
        }
        assert!(measured > 0, "no frame was measured");
    }
}
