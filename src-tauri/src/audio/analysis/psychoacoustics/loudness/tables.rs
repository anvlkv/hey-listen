//! Reference tables for the Moore–Glasberg stationary loudness model (M27).
//!
//! The values follow the published Moore–Glasberg / ISO 532-2 formulation as
//! implemented by the [Phonometry](https://github.com/jmrplens/phonometry)
//! reference: the outer/middle-ear transfer (Table 1), the cochlear
//! threshold/gain/coefficient tables (Tables 2–4), and the level-dependent roex
//! parameters. They are a **published approximation, not a conformance claim** —
//! the normative standard is not reproduced in full here.
//!
//! See `docs/psychoacoustics-references.md` → "Loudness".

/// Table 1: frequencies (Hz).
pub(super) const T1_FREQ: [f64; 39] = [
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0, 200.0, 250.0, 315.0, 400.0,
    500.0, 630.0, 750.0, 800.0, 1000.0, 1250.0, 1500.0, 1600.0, 2000.0, 2500.0, 3000.0, 3150.0,
    4000.0, 5000.0, 6000.0, 6300.0, 8000.0, 9000.0, 10000.0, 11200.0, 12500.0, 14000.0, 15000.0,
    16000.0, 20000.0,
];

/// Table 1: free-field outer-ear transfer (dB).
pub(super) const T1_FREE: [f64; 39] = [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.3, 0.5, 0.9, 1.4, 1.6, 1.7, 2.5, 2.7, 2.6, 2.6,
    3.2, 5.2, 6.6, 12.0, 16.8, 15.3, 15.2, 14.2, 10.7, 7.1, 6.4, 1.8, -0.9, -1.6, 1.9, 4.9, 2.0,
    -2.0, 2.5, 2.5,
];

/// Table 1: middle-ear transfer (dB).
pub(super) const T1_MIDDLE: [f64; 39] = [
    -39.6, -32.0, -25.85, -21.4, -18.5, -15.9, -14.1, -12.4, -11.0, -9.6, -8.3, -7.4, -6.2, -4.8,
    -3.8, -3.3, -2.9, -2.6, -2.6, -4.5, -5.4, -6.1, -8.5, -10.4, -7.3, -7.0, -6.6, -7.0, -9.2,
    -10.2, -12.2, -10.8, -10.1, -12.7, -15.0, -18.2, -23.8, -32.3, -45.5,
];

/// Table 2: centre frequencies (Hz) for the low-frequency cochlea parameters.
pub(super) const T2_FREQ: [f64; 15] = [
    50.0, 63.0, 80.0, 100.0, 125.0, 160.0, 200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 750.0, 800.0,
    1000.0,
];

/// Table 2: excitation level at threshold (dB).
pub(super) const T2_LE_THR: [f64; 15] = [
    27.46, 23.45, 18.47, 15.13, 11.97, 9.34, 7.43, 5.75, 4.73, 3.92, 3.15, 3.15, 3.15, 3.15, 3.15,
];

/// Table 2: `10 lg G` (dB) of the cochlear gain.
pub(super) const T2_10LGG: [f64; 15] = [
    -24.31, -20.30, -15.32, -11.98, -8.82, -6.19, -4.28, -2.60, -1.58, -0.77, 0.0, 0.0, 0.0, 0.0,
    0.0,
];

/// Table 3: `10 lg G` (dB) grid for the exponent `alpha`.
pub(super) const T3_10LGG: [f64; 6] = [-25.0, -20.0, -15.0, -10.0, -5.0, 0.0];

/// Table 3: the compressive exponent `alpha`.
pub(super) const T3_ALPHA: [f64; 6] = [0.26692, 0.25016, 0.23679, 0.22228, 0.21055, 0.20000];

/// Table 4: `10 lg G` (dB) grid (0.5 dB steps, −25…0) for the parameter `A`.
pub(super) const T4_10LGG: [f64; 51] = [
    -25.0, -24.5, -24.0, -23.5, -23.0, -22.5, -22.0, -21.5, -21.0, -20.5, -20.0, -19.5, -19.0,
    -18.5, -18.0, -17.5, -17.0, -16.5, -16.0, -15.5, -15.0, -14.5, -14.0, -13.5, -13.0, -12.5,
    -12.0, -11.5, -11.0, -10.5, -10.0, -9.5, -9.0, -8.5, -8.0, -7.5, -7.0, -6.5, -6.0, -5.5, -5.0,
    -4.5, -4.0, -3.5, -3.0, -2.5, -2.0, -1.5, -1.0, -0.5, 0.0,
];

/// Table 4: the parameter `A`.
pub(super) const T4_A: [f64; 51] = [
    7.784, 7.667, 7.551, 7.435, 7.318, 7.210, 7.103, 6.996, 6.889, 6.782, 6.675, 6.596, 6.517,
    6.438, 6.360, 6.281, 6.202, 6.124, 6.047, 5.975, 5.902, 5.823, 5.744, 5.665, 5.587, 5.510,
    5.437, 5.364, 5.291, 5.218, 5.145, 5.086, 5.027, 4.972, 4.918, 4.863, 4.808, 4.754, 4.699,
    4.644, 4.590, 4.542, 4.496, 4.451, 4.405, 4.359, 4.314, 4.268, 4.222, 4.177, 4.131,
];

/// Linear interpolation of `ys` at `x`, clamped outside `xs`.
pub(super) fn interp(x: f64, xs: &[f64], ys: &[f64]) -> f64 {
    let (Some(&first), Some(&last)) = (xs.first(), xs.last()) else {
        return 0.0;
    };
    if x <= first {
        return ys.first().copied().unwrap_or(0.0);
    }
    if x >= last {
        return ys.last().copied().unwrap_or(0.0);
    }
    let upper = xs.partition_point(|&value| value <= x);
    let (x0, x1) = (xs[upper - 1], xs[upper]);
    let (y0, y1) = (ys[upper - 1], ys[upper]);
    let fraction = if x1 > x0 { (x - x0) / (x1 - x0) } else { 0.0 };
    y0 + fraction * (y1 - y0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tables_are_aligned() {
        assert_eq!(T1_FREE.len(), T1_FREQ.len());
        assert_eq!(T1_MIDDLE.len(), T1_FREQ.len());
        assert_eq!(T2_LE_THR.len(), T2_FREQ.len());
        assert_eq!(T2_10LGG.len(), T2_FREQ.len());
        assert_eq!(T3_ALPHA.len(), T3_10LGG.len());
        assert_eq!(T4_A.len(), T4_10LGG.len());
    }

    #[test]
    fn interp_hits_the_samples_and_clamps_outside() {
        assert_eq!(interp(1000.0, &T1_FREQ, &T1_FREE), 2.6);
        assert_eq!(interp(0.0, &T1_FREQ, &T1_FREE), 0.0);
        assert_eq!(interp(30_000.0, &T1_FREQ, &T1_FREE), 2.5);
        // Halfway between 100 and 125 Hz: the mean of 0.0 and 0.1.
        assert!((interp(112.5, &T1_FREQ, &T1_FREE) - 0.05).abs() < 1e-9);
    }
}
