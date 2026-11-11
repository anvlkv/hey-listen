//! The `roughness` analyzer (M29): perceived roughness in asper.
//!
//! A sound is *rough* when the energy in its critical bands fluctuates rapidly — the
//! harsh, buzzy quality of a rolled "r" or a distorted guitar. The model runs the
//! shared band-envelope → modulation-filter pipeline
//! ([`super::super::psychoacoustics::modulation`]) with a modulation filter centred at
//! **70 Hz**, weights the bands by the perceived-frequency taper `g(z)`, discounts
//! adjacent bands that modulate in step, and calibrates the result so a 1 kHz tone at
//! 60 dB SPL, 100 % amplitude-modulated at 70 Hz reads about **1 asper**.
//!
//! A steady carrier reads about 0. Values are a **model approximation** of the
//! published signal-processing roughness models, not a conformance implementation of
//! any standard (see the pipeline's module note).
//!
//! Two further limits are worth knowing before reading the number:
//!
//! - **Frequency range.** Bands more than 40 dB below the frame's broadband level are
//!   gated out, so a carrier outside the selected range does not reach the modulation
//!   filter through the band-pass skirts. Spectrally adjacent carriers still overlap a
//!   band by design.
//! - **Level.** The level weighting is one-sided: full scale at the reference level and
//!   above, 6 dB down per halving below it. Scaling a reference-level signal *up* does
//!   not raise the asper count, so an amplitude sweep is not a roughness-versus-level
//!   curve.

use super::super::psychoacoustics::modulation::{modulate, roughness_weighting, series};
use super::super::{AnalysisError, CalibratedSeriesResult, SharedParams, ToolOptions};

/// Perceived roughness per analysis frame, in asper.
pub(super) fn roughness(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<CalibratedSeriesResult, AnalysisError> {
    let calibration = options.calibration_db_spl();
    let modulation = modulate(
        mono,
        sample_rate,
        params,
        &roughness_weighting(),
        calibration,
    );
    Ok(series(modulation, sample_rate, calibration, "asper"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::tests::{params, RATE};

    #[test]
    fn an_uncalibrated_run_is_labelled() {
        let mono = vec![0.1f32; 4_800];
        let result =
            roughness(&mono, RATE, &params(2_048), &ToolOptions::default()).expect("roughness");
        assert!(!result.calibrated);
        assert_eq!(result.calibration_db_spl, 0.0);
        assert_eq!(result.values.len(), result.times.len());
    }

    #[test]
    fn silence_has_no_measured_frames() {
        let mono = vec![0.0f32; 4_800];
        let result =
            roughness(&mono, RATE, &params(2_048), &ToolOptions::default()).expect("roughness");
        assert!(result.values.iter().all(Option::is_none));
        assert_eq!(result.min_value, 0.0);
        assert_eq!(result.max_value, 0.0);
    }

    #[test]
    fn a_run_carries_the_contribution_grids() {
        // A 70 Hz-modulated 1 kHz carrier: the contribution grid's columns are the Bark
        // bands, in the tool's own unit, and its rows line up with the scalar track. The
        // band × rate matrix rides the same frames (M36).
        let rate = RATE as f32;
        let mono: Vec<f32> = (0..4_800)
            .map(|index| {
                let time = index as f32 / rate;
                let envelope = 1.0 + (std::f32::consts::TAU * 70.0 * time).cos();
                0.1 * envelope * (std::f32::consts::TAU * 1_000.0 * time).cos()
            })
            .collect();
        let result =
            roughness(&mono, RATE, &params(2_048), &ToolOptions::default()).expect("roughness");
        let contribution = result.contribution.as_ref().expect("a contribution grid");
        contribution.assert_consistent();
        assert_eq!(contribution.frames, result.values.len());
        assert_eq!(contribution.label, "band modulation");
        assert_eq!(contribution.unit.as_deref(), Some("asper"));
        let rates = result
            .rate_contribution
            .as_ref()
            .expect("a band × rate matrix");
        rates.assert_consistent();
        assert_eq!(rates.frames, result.values.len());
        assert_eq!(rates.bands, contribution.bins);
        assert!(rates.rates > 1, "the rate axis has one column");
    }
}
