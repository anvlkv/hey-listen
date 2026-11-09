//! The `tonality` analyzer (M30): the tonal-energy ratio `H = E_tonal / E_total`.
//!
//! Per analysis frame the same tonal/non-tonal masker detection the `masking` tool uses
//! classifies the spectrum's tonal components; `H` is the share of the frame's power
//! those components carry (0…1), summed over each peak's **main lobe** (not just its
//! peak bin), so a bin-centred and a half-bin-centred Hann tone both read close to 1.
//! Broadband noise is close to 0.
//!
//! This is a **documented custom proxy**, not a standardized perceptual tonality
//! metric: the value depends entirely on how a tonal component is detected, and the
//! fixed MPEG-style rule is one defensible choice rather than a conformance claim.

use super::super::psychoacoustics::masking::tonal_energy_fraction;
use super::super::support::{
    db_or_floor, effective_hop, effective_params, frame_times, stft_magnitudes,
};
use super::super::{AnalysisError, CalibratedSeriesResult, SharedParams, ToolOptions, DB_FLOOR};
use super::shared::series_extents;

/// Cap on the frames the per-frame detection runs over, so a long window stays
/// interactive (the hop widens to keep the frame count bounded).
const MAX_TONALITY_FRAMES: usize = 1_024;

/// Tonal-energy ratio per STFT frame (0…1).
pub(super) fn tonality(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<CalibratedSeriesResult, AnalysisError> {
    let params = effective_params(params, sample_rate);
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let hop = hop.max(mono.len().div_ceil(MAX_TONALITY_FRAMES).max(1));
    let (mags, _) = stft_magnitudes(mono, sample_rate, fft, hop, &params)?;

    let bins = fft / 2 + 1;
    let (min_hz, max_hz) = params.band(sample_rate);
    let kept: Vec<usize> = (0..bins)
        .filter(|&k| {
            let hz = k as f64 * f64::from(sample_rate) / fft as f64;
            hz >= min_hz && hz <= max_hz
        })
        .collect();
    let freqs: Vec<f32> = kept
        .iter()
        .map(|&k| (k as f64 * f64::from(sample_rate) / fft as f64) as f32)
        .collect();
    let calibration = options.calibration_db_spl();

    let values: Vec<Option<f32>> = mags
        .iter()
        .map(|frame| {
            let levels: Vec<f32> = kept
                .iter()
                .map(|&k| {
                    let magnitude = f64::from(frame[k]);
                    let db = if magnitude > 0.0 {
                        db_or_floor((20.0 * magnitude.log10()) as f32)
                    } else {
                        DB_FLOOR
                    };
                    db + calibration
                })
                .collect();
            Some(tonal_energy_fraction(&freqs, &levels))
        })
        .collect();

    let (min_value, max_value) = series_extents(&values);
    Ok(CalibratedSeriesResult {
        sample_rate,
        hop_size: hop,
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        times: frame_times(values.len(), hop, sample_rate),
        values,
        min_value,
        max_value,
        calibrated: calibration > 0.0,
        calibration_db_spl: calibration,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::tests::{median, params, tone, RATE};

    /// A deterministic white-noise buffer (a small LCG, so the test never flakes).
    fn noise(frames: usize) -> Vec<f32> {
        let mut state = 0x1234_5678u32;
        (0..frames)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                ((state >> 8) as f32 / (1u32 << 24) as f32) * 2.0 - 1.0
            })
            .collect()
    }

    #[test]
    fn a_pure_sine_is_highly_tonal_and_noise_is_not() {
        let sine = tonality(
            &tone(0.5, 1_000.0, 0.5),
            RATE,
            &params(4_096),
            &ToolOptions::default(),
        )
        .expect("tonality");
        let sine_ratio = median(&sine.values);
        assert!(
            sine_ratio > 0.5,
            "a 1 kHz sine reads {sine_ratio:.3} tonality, expected > 0.5"
        );

        let noisy = tonality(
            &noise(RATE as usize / 2),
            RATE,
            &params(4_096),
            &ToolOptions::default(),
        )
        .expect("tonality");
        let noise_ratio = median(&noisy.values);
        assert!(
            noise_ratio < 0.5,
            "white noise reads {noise_ratio:.3} tonality, expected < 0.5"
        );
    }

    #[test]
    fn an_on_bin_and_a_half_bin_tone_read_near_one() {
        // 48 kHz / 4096 puts bin 85 at 996.09375 Hz; 85.5 is the worst-case scallop.
        const BIN_HZ: f32 = 48_000.0 / 4_096.0;
        let ratio = |hz: f32| {
            let result = tonality(
                &tone(0.5, hz, 0.5),
                RATE,
                &params(4_096),
                &ToolOptions::default(),
            )
            .expect("tonality");
            median(&result.values)
        };
        let on_bin = ratio(85.0 * BIN_HZ);
        let half_bin = ratio(85.5 * BIN_HZ);
        assert!(on_bin > 0.9, "on-bin tone reads {on_bin:.3}");
        assert!(half_bin > 0.9, "half-bin tone reads {half_bin:.3}");
        assert!(
            (on_bin - half_bin).abs() < 0.1,
            "alignment moved the ratio: {on_bin:.3} vs {half_bin:.3}"
        );
    }

    #[test]
    fn an_uncalibrated_run_is_labelled() {
        let result = tonality(
            &tone(0.5, 1_000.0, 0.5),
            RATE,
            &params(2_048),
            &ToolOptions::default(),
        )
        .expect("tonality");
        assert!(!result.calibrated);
        assert_eq!(result.calibration_db_spl, 0.0);
        assert_eq!(result.values.len(), result.times.len());
    }
}
