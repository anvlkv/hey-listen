//! The absolute threshold of hearing `Tq(f)` (M30).
//!
//! ```text
//! Tq(f) = 3.64 (f/1000)^-0.8 − 6.5 e^(−0.6 (f/1000 − 3.3)^2) + 1e-3 (f/1000)^4
//! ```
//!
//! in **dB SPL**. This is an empirical approximation of the threshold in quiet: it
//! assumes a quiet listening context and no individual differences, so it is a
//! reference curve, not a hearing model. The formula diverges below a few hertz and
//! above the audible range (its fourth-power term reaches ~160 dB SPL at 20 kHz), so
//! it is evaluated inside `[MIN_ATH_HZ, MAX_ATH_HZ]`. A bin outside that window reuses
//! the nearest edge value, which keeps `Tq` — and the power-domain threshold built on
//! it — finite at any sample rate.

/// The lowest frequency the approximation is evaluated at.
const MIN_ATH_HZ: f32 = 20.0;
/// The highest frequency the approximation is evaluated at. Above the model's valid
/// domain the fourth-power term diverges, so a 48/96 kHz Nyquist bin is clamped here.
const MAX_ATH_HZ: f32 = 20_000.0;

/// The threshold in quiet at `hz` (dB SPL).
pub fn threshold_quiet_db(hz: f32) -> f32 {
    let hz = if hz.is_finite() { hz } else { MIN_ATH_HZ };
    let f = hz.clamp(MIN_ATH_HZ, MAX_ATH_HZ) / 1000.0;
    3.64 * f.powf(-0.8) - 6.5 * (-0.6 * (f - 3.3).powi(2)).exp() + 1e-3 * f.powi(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_curve_is_lowest_around_the_mid_frequencies() {
        // The published curve bottoms out near 3–4 kHz at a few dB SPL (the formula
        // actually dips slightly below 0 dB SPL there).
        let mid = threshold_quiet_db(3_500.0);
        assert!((-6.0..6.0).contains(&mid), "Tq(3.5 kHz) = {mid} dB SPL");
        // It rises toward both ends of the audible range.
        assert!(threshold_quiet_db(20.0) > 60.0);
        assert!(threshold_quiet_db(15_000.0) > mid);
        // 1 kHz sits near 3.4 dB SPL.
        let one_khz = threshold_quiet_db(1_000.0);
        assert!((one_khz - 3.4).abs() < 1.0, "Tq(1 kHz) = {one_khz} dB SPL");
    }

    #[test]
    fn sub_audible_and_non_finite_input_stays_finite() {
        assert_eq!(threshold_quiet_db(0.0), threshold_quiet_db(MIN_ATH_HZ));
        assert!(threshold_quiet_db(f32::NAN).is_finite());
    }

    #[test]
    fn high_sample_rate_bins_stay_finite() {
        // The fourth-power term overflows a power-domain sum beyond ~42 kHz; clamping
        // the model domain keeps a 48/96 kHz full-band run finite.
        for hz in [42_000.0, 48_000.0, 96_000.0] {
            let tq = threshold_quiet_db(hz);
            assert!(tq.is_finite(), "Tq({hz}) = {tq} dB SPL");
        }
        assert!(
            (threshold_quiet_db(48_000.0) - threshold_quiet_db(MAX_ATH_HZ)).abs() < 1e-3,
            "the 20 kHz cap is not applied"
        );
    }
}
