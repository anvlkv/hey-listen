//! The `fluctuationStrength` analyzer (M29): perceived fluctuation strength in vacil.
//!
//! A sound *fluctuates* when its energy pulses slowly — the wobble of a tremolo or a
//! distant helicopter. The model runs the shared band-envelope → modulation-filter
//! pipeline ([`super::super::psychoacoustics::modulation`]) with a modulation filter
//! centred at **4 Hz**, weights the bands by the perceived-frequency taper `g(z)` and
//! by how strongly adjacent bands modulate together, and calibrates the result so a
//! 1 kHz tone at 60 dB SPL, 100 % amplitude-modulated at 4 Hz reads about **1 vacil**.
//!
//! A steady carrier reads about 0. This is the same model approximation as
//! `roughness`, with the slow-rate weighting — not a conformance implementation of any
//! standard (see the pipeline's module note).

use super::super::psychoacoustics::modulation::{fluctuation_weighting, modulate, series};
use super::super::{AnalysisError, CalibratedSeriesResult, SharedParams, ToolOptions};

/// Perceived fluctuation strength per analysis frame, in vacil.
pub(super) fn fluctuation_strength(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<CalibratedSeriesResult, AnalysisError> {
    let calibration = options.calibration_db_spl();
    let (hop, values) = modulate(
        mono,
        sample_rate,
        params,
        &fluctuation_weighting(),
        calibration,
    );
    Ok(series(values, hop, sample_rate, calibration))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::tests::{params, RATE};

    #[test]
    fn an_uncalibrated_run_is_labelled() {
        // A slow pulse so the frame has something to measure.
        let rate = RATE as f32;
        let mono: Vec<f32> = (0..(rate * 0.5) as usize)
            .map(|index| {
                let time = index as f32 / rate;
                let envelope = 1.0 + (std::f32::consts::TAU * 4.0 * time).cos();
                0.02 * envelope * (std::f32::consts::TAU * 1_000.0 * time).cos()
            })
            .collect();
        let result = fluctuation_strength(&mono, RATE, &params(2_048), &ToolOptions::default())
            .expect("fluctuation strength");
        assert!(!result.calibrated);
        assert_eq!(result.calibration_db_spl, 0.0);
        assert_eq!(result.values.len(), result.times.len());
        assert!(result.values.iter().flatten().any(|&value| value > 0.1));
    }
}
