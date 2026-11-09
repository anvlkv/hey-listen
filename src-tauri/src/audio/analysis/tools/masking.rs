//! The `masking` analyzer (M30): the spectrum with its threshold in quiet, the
//! Bark-spread global masking threshold, and the signal-to-mask ratio.
//!
//! The window's STFT magnitude is averaged per bin as **power**, converted to a level
//! (dB SPL when `calibrationDbSpl` is set, dBFS otherwise), and handed to
//! [`masking_thresholds`], which detects tonal/non-tonal maskers and spreads them. A
//! negative `smrDb` means the line sits under the estimated threshold, so it is
//! probably inaudible beneath its neighbours. This is the MPEG-style codec model, not
//! a universal predictor of human detection.

use super::super::psychoacoustics::masking::masking_thresholds;
use super::super::support::db_or_floor;
use super::super::{AnalysisError, MaskingResult, SharedParams, ToolOptions, DB_FLOOR};
use super::shared::band_stft;

/// The averaged spectrum and its masking model over the analysis window.
pub(super) fn masking(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MaskingResult, AnalysisError> {
    let band = band_stft(mono, sample_rate, params)?;
    let calibration = options.calibration_db_spl();

    let mut freqs = Vec::with_capacity(band.bins.len());
    let mut spectrum_db = Vec::with_capacity(band.bins.len());
    for (index, &k) in band.bins.iter().enumerate() {
        let mean_power = if band.frames > 0 {
            band.magnitudes
                .iter()
                .map(|frame| f64::from(frame[k]).powi(2))
                .sum::<f64>()
                / band.frames as f64
        } else {
            0.0
        };
        let db = if mean_power > 0.0 {
            db_or_floor((10.0 * mean_power.log10()) as f32)
        } else {
            DB_FLOOR
        };
        freqs.push(band.freqs[index]);
        spectrum_db.push(db + calibration);
    }

    let model = masking_thresholds(&freqs, &spectrum_db);
    Ok(MaskingResult {
        sample_rate,
        fft_size: band.fft,
        frames: band.frames,
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        freqs,
        spectrum_db,
        threshold_quiet_db: model.threshold_quiet_db,
        global_mask_db: model.global_mask_db,
        smr_db: model.smr_db,
        calibrated: calibration > 0.0,
        calibration_db_spl: calibration,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::tests::{calibration, params, tone, RATE};

    /// A loud tone plus a nearby quiet one, summed sample by sample.
    fn two_tone(loud: f32, quiet: f32) -> Vec<f32> {
        let loud = tone(0.5, loud, 0.5);
        let quiet = tone(0.005, quiet, 0.5);
        loud.iter().zip(&quiet).map(|(a, b)| a + b).collect()
    }

    /// The strongest bin within `centre ± width` Hz.
    fn peak_near(result: &MaskingResult, centre: f32, width: f32) -> usize {
        result
            .freqs
            .iter()
            .enumerate()
            .filter(|(_, hz)| (**hz - centre).abs() <= width)
            .max_by(|a, b| result.spectrum_db[a.0].total_cmp(&result.spectrum_db[b.0]))
            .map(|(index, _)| index)
            .expect("a bin near the tone")
    }

    #[test]
    fn a_quiet_tone_near_a_loud_one_is_masked() {
        let mono = two_tone(1_000.0, 1_200.0);
        let result = masking(&mono, RATE, &params(4_096), &calibration(94.0)).expect("masking");
        assert!(result.calibrated);
        assert_eq!(result.calibration_db_spl, 94.0);
        assert_eq!(result.smr_db.len(), result.freqs.len());

        let quiet = peak_near(&result, 1_200.0, 50.0);
        assert!(
            result.smr_db[quiet] < 0.0,
            "the quiet 1.2 kHz tone reads SMR {:.1} dB, expected it masked (< 0)",
            result.smr_db[quiet]
        );
        // The loud tone clears its own threshold.
        let loud = peak_near(&result, 1_000.0, 50.0);
        assert!(
            result.smr_db[loud] > 0.0,
            "loud tone SMR = {}",
            result.smr_db[loud]
        );

        for (tq, tg) in result.threshold_quiet_db.iter().zip(&result.global_mask_db) {
            assert!(tg >= tq, "Tg {tg} < Tq {tq}");
        }
    }

    #[test]
    fn an_uncalibrated_run_is_labelled() {
        let mono = tone(0.5, 1_000.0, 0.5);
        let result =
            masking(&mono, RATE, &params(2_048), &ToolOptions::default()).expect("masking");
        assert!(!result.calibrated);
        assert_eq!(result.calibration_db_spl, 0.0);
        assert_eq!(result.spectrum_db.len(), result.freqs.len());
    }
}
