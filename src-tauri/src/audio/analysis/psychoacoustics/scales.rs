//! Bark and ERB auditory frequency scales, both directions (M26).
//!
//! Equations from [`docs/psychoacoustics-references.md`] → "Auditory frequency
//! scales". Bark and ERB are **not interchangeable**: Bark is the Zwicker / MPEG
//! axis, ERB the Moore–Glasberg one.

/// Which critical-band axis a perception tool integrates into.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Scale {
    /// The Zwicker / MPEG-style critical-band rate (the default).
    #[default]
    Bark,
    /// The Moore–Glasberg ERB-rate (Cam) axis.
    Erb,
}

/// ERB bandwidth at `f` Hz: `24.7 (1 + 0.00437 f)`.
pub fn erb_hz(f: f32) -> f32 {
    24.7 * (1.0 + 0.00437 * f)
}

/// The ERB-rate (Cam) of `f` Hz: `21.4 log10(1 + 0.00437 f)`.
///
/// Written through [`erb_hz`] so the bandwidth formula lives in one place:
/// `1 + 0.00437 f = erb_hz(f) / 24.7`.
pub fn cam(f: f32) -> f32 {
    21.4 * (erb_hz(f) / 24.7).log10()
}

/// Frequency (Hz) at ERB-rate `cam`: `(10^(E / 21.4) - 1) / 0.00437`.
pub fn cam_to_hz(cam: f32) -> f32 {
    (10f32.powf(cam / 21.4) - 1.0) / 0.00437
}

/// Critical-band rate (Bark) of `f` Hz:
/// `13 atan(0.00076 f) + 3.5 atan((f/7500)^2)`.
pub fn bark(f: f32) -> f32 {
    13.0 * (0.00076 * f).atan() + 3.5 * (f / 7500.0).powi(2).atan()
}

/// Frequency (Hz) at critical-band rate `z` Bark — the numerical inverse of
/// [`bark`] (the equation has no closed form). Bisection is enough: `bark` is
/// strictly increasing, the audible range spans ~24 Bark, and the callers only
/// need band edges.
pub fn bark_to_hz(z: f32) -> f32 {
    if !z.is_finite() || z <= 0.0 {
        return 0.0;
    }
    // The audible range tops out well below 250 kHz; `bark(250 kHz)` is above
    // the ~26 Bark the axis asymptotes to, so the bracket always contains `z`.
    let (mut low, mut high) = (0.0f32, 250_000.0f32);
    for _ in 0..48 {
        let mid = 0.5 * (low + high);
        if bark(mid) < z {
            low = mid;
        } else {
            high = mid;
        }
    }
    0.5 * (low + high)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erb_rate_round_trips_through_hz() {
        for f in [0.0, 100.0, 1_000.0, 4_000.0, 10_000.0] {
            let round = cam_to_hz(cam(f));
            let tolerance = f.max(1.0) * 1e-3;
            assert!(
                (round - f).abs() <= tolerance,
                "cam round trip: {f} Hz → {round} Hz"
            );
        }
    }

    #[test]
    fn bark_starts_at_zero_and_is_monotonic() {
        assert_eq!(bark(0.0), 0.0);
        assert_eq!(bark_to_hz(0.0), 0.0);
        let mut previous = -1.0;
        for f in (0..=20_000).step_by(250) {
            let z = bark(f as f32);
            assert!(z > previous, "bark({f}) = {z} is not increasing");
            previous = z;
        }
        // The numerical inverse lands back on the frequency.
        for f in [100.0, 1_000.0, 10_000.0] {
            let round = bark_to_hz(bark(f));
            assert!(
                (round - f).abs() <= f.max(1.0) * 2e-3,
                "bark round trip: {f} Hz → {round} Hz"
            );
        }
    }

    #[test]
    fn erb_bandwidth_grows_with_frequency() {
        assert!(erb_hz(1_000.0) > erb_hz(100.0));
        assert!((erb_hz(0.0) - 24.7).abs() < 1e-3);
    }
}
