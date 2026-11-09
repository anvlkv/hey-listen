//! The absolute threshold of hearing `Tq(f)` (M30).
//!
//! ```text
//! Tq(f) = 3.64 (f/1000)^-0.8 − 6.5 e^(−0.6 (f/1000 − 3.3)^2) + 1e-3 (f/1000)^4
//! ```
//!
//! in **dB SPL**. This is an empirical approximation of the threshold in quiet: it
//! assumes a quiet listening context and no individual differences, so it is a
//! reference curve, not a hearing model. The formula diverges below a few hertz, and
//! is only meaningful over the audible range, so lower frequencies are evaluated at
//! [`MIN_ATH_HZ`].

/// The lowest frequency the approximation is evaluated at.
const MIN_ATH_HZ: f32 = 20.0;

/// The threshold in quiet at `hz` (dB SPL).
pub fn threshold_quiet_db(hz: f32) -> f32 {
    let f = if hz.is_finite() {
        hz.max(MIN_ATH_HZ)
    } else {
        MIN_ATH_HZ
    } / 1000.0;
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
}
