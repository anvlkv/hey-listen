//! Mid/side decomposition and normalized inter-channel correlation (M31).
//!
//! For a stereo pair:
//!
//! ```text
//! M[n] = (L[n] + R[n]) / 2      S[n] = (L[n] − R[n]) / 2
//! ρ_LR = Σ L[n] R[n] / sqrt( Σ L[n]² · Σ R[n]² )
//! ```
//!
//! These are **acoustic cues**: mid/side energy and inter-channel correlation
//! describe stereo structure. They do not by themselves estimate a perceived width,
//! which also depends on playback configuration and listening conditions.
//!
//! The components are amplitude ratios, so mid/side are reported in **dBFS** — not
//! dB SPL. A calibration offset does not apply to them (and cancels from `ρ_LR`).

/// One sample's mid and side components.
pub fn mid_side(left: f32, right: f32) -> (f32, f32) {
    ((left + right) / 2.0, (left - right) / 2.0)
}

/// Root-mean-square amplitude of `samples` (`0` for an empty slice).
pub fn rms(samples: &[f32]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples
        .iter()
        .map(|&sample| f64::from(sample).powi(2))
        .sum();
    (sum / samples.len() as f64).sqrt()
}

/// Normalized inter-channel correlation over one frame, in `[-1, 1]`.
///
/// Returns `None` when both channels are silent (no correlation is defined).
/// When exactly one channel is silent — a **hard-panned** frame — the correlation
/// is defined as `0` rather than a division by zero: the two channels carry no
/// shared signal.
pub fn correlation(left: &[f32], right: &[f32]) -> Option<f32> {
    let len = left.len().min(right.len());
    let (mut lr, mut ll, mut rr) = (0.0f64, 0.0f64, 0.0f64);
    for index in 0..len {
        let l = f64::from(left[index]);
        let r = f64::from(right[index]);
        lr += l * r;
        ll += l * l;
        rr += r * r;
    }
    if ll <= f64::EPSILON && rr <= f64::EPSILON {
        return None;
    }
    let denominator = (ll * rr).sqrt();
    Some(if denominator <= f64::EPSILON {
        0.0
    } else {
        (lr / denominator).clamp(-1.0, 1.0) as f32
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_channels_are_perfectly_correlated() {
        let signal = [0.5f32, -0.5, 0.25, -0.25];
        assert_eq!(correlation(&signal, &signal), Some(1.0));
    }

    #[test]
    fn hard_panned_frames_are_uncorrelated() {
        let left = [0.5f32, -0.5, 0.25, -0.25];
        let right = [0.0f32; 4];
        assert_eq!(correlation(&left, &right), Some(0.0));
    }

    #[test]
    fn silence_has_no_correlation() {
        assert_eq!(correlation(&[0.0; 4], &[0.0; 4]), None);
    }
}
