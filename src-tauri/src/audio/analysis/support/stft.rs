//! The shared STFT magnitude passes.
//!
//! Two normalizations coexist and must not be interchanged:
//! [`stft_magnitudes`] is the **amplitude** path (a bin-centred sine's peak bin
//! reads its amplitude; DC and Nyquist are real-only), while
//! [`stft_power_magnitudes`] is the **energy** path (Parseval-normalized, so a
//! full-scale sine reads −3.01 dBFS RMS). See each function's documentation.

use oxiaudio::dsp::spectral::stft;

use super::super::{AnalysisError, SharedParams, WindowKind};
use super::mono_buffer;

/// The one-sided factor for `bin`: DC and the Nyquist bin of an even-length
/// transform are real-only and counted once; every other bin is doubled.
fn one_sided_factor(fft: usize, bin: usize) -> f64 {
    if bin == 0 || (fft.is_multiple_of(2) && bin == fft / 2) {
        1.0
    } else {
        2.0
    }
}

/// One-sided magnitudes `|X[k]|` per frame (`frames[t][k]`, `k` in `0..=fft/2`).
///
/// When `randomized_overlap` is set, a second STFT is taken half a hop off and the
/// magnitudes are averaged in, breaking the fixed frame-grid alignment (the
/// `stft` batch API exposes no jitter option itself). A window shorter than the
/// FFT is zero-padded so it still yields one frame.
fn raw_magnitudes(
    mono: &[f32],
    sample_rate: u32,
    fft: usize,
    hop: usize,
    params: &SharedParams,
) -> Result<(Vec<Vec<f32>>, usize), AnalysisError> {
    let bins = fft / 2 + 1;
    let window = params.window_fn.to_window_fn();

    let frame_mags = |samples: &[f32]| -> Result<Vec<Vec<f32>>, AnalysisError> {
        let buf = mono_buffer(samples, sample_rate);
        let out =
            stft(&buf, fft, hop, window).map_err(|err| AnalysisError::Analysis(err.to_string()))?;
        Ok(out
            .frames
            .iter()
            .map(|frame| {
                frame
                    .iter()
                    .take(bins)
                    .map(|c| (c.re * c.re + c.im * c.im).sqrt())
                    .collect()
            })
            .collect())
    };

    let padded;
    let signal: &[f32] = if mono.len() < fft {
        padded = {
            let mut buffer = vec![0.0f32; fft];
            buffer[..mono.len()].copy_from_slice(mono);
            buffer
        };
        &padded
    } else {
        mono
    };

    let mut mags = frame_mags(signal)?;
    if params.randomized_overlap && !mags.is_empty() {
        let shift = (hop / 2).max(1);
        // The shifted pass needs a full window of its own to yield frames.
        if signal.len() > shift + fft {
            let shifted = frame_mags(&signal[shift..])?;
            for (frame, other) in mags.iter_mut().zip(shifted.iter()) {
                for (bin, other_bin) in frame.iter_mut().zip(other.iter()) {
                    *bin = 0.5 * (*bin + *other_bin);
                }
            }
        }
    }
    let frames = mags.len();
    Ok((mags, frames))
}

/// STFT magnitudes per frame (`frames[t][k]`, `k` in `0..=fft/2`).
///
/// The **amplitude** path: coherent-gain normalization (`1 / Σw`) so a bin-centred
/// sine's peak bin reads its amplitude regardless of FFT size or window. The
/// one-sided factor is two for interior bins and **one** for the real-only DC and
/// Nyquist bins, so a rectangular-window DC of 1 reads 0 dBFS (amplitude 1), not
/// +6.02 dBFS. This is a peak-amplitude scale, not an energy scale — use
/// [`stft_power_magnitudes`] for power.
pub(in crate::audio::analysis) fn stft_magnitudes(
    mono: &[f32],
    sample_rate: u32,
    fft: usize,
    hop: usize,
    params: &SharedParams,
) -> Result<(Vec<Vec<f32>>, usize), AnalysisError> {
    let (raw, frames) = raw_magnitudes(mono, sample_rate, fft, hop, params)?;
    let gain = 1.0 / window_gain(params.window_fn, fft);
    let magnitudes = raw
        .iter()
        .map(|frame| {
            frame
                .iter()
                .enumerate()
                .map(|(bin, magnitude)| magnitude * (gain * one_sided_factor(fft, bin)) as f32)
                .collect()
        })
        .collect();
    Ok((magnitudes, frames))
}

/// Energy-conserving one-sided magnitudes per frame.
///
/// `m[k] = |X[k]| · sqrt(factor_k / (N · Σw²))`, with `factor_k` one for the
/// real-only DC/Nyquist bins and two elsewhere. By Parseval `Σ_k m[k]²` is the
/// frame's mean square (exactly `Σ w²x² / Σw²`, i.e. the windowed mean square, and
/// exactly the plain mean square for a rectangular window). Each `m[k]` is therefore
/// an RMS-equivalent component, and the convention is the **full-scale-sine
/// −3.01 dBFS RMS** one: amplitude 1 reads 0 dBFS on the amplitude path but
/// 0.7071 (−3.01 dBFS) here, because a sine's mean square is `A² / 2`.
///
/// The identity holds per STFT pass; with `randomized_overlap` two half-hop-shifted
/// magnitude passes are averaged, so the per-frame sum is approximate there.
///
/// This is the path the power/energy consumers (`criticalBands`, `loudness`) use;
/// [`stft_magnitudes`] stays the amplitude/spectrum path.
pub(in crate::audio::analysis) fn stft_power_magnitudes(
    mono: &[f32],
    sample_rate: u32,
    fft: usize,
    hop: usize,
    params: &SharedParams,
) -> Result<(Vec<Vec<f32>>, usize), AnalysisError> {
    let (raw, frames) = raw_magnitudes(mono, sample_rate, fft, hop, params)?;
    let denominator = fft as f64 * window_energy(params.window_fn, fft);
    let magnitudes = raw
        .iter()
        .map(|frame| {
            frame
                .iter()
                .enumerate()
                .map(|(bin, magnitude)| {
                    let power =
                        f64::from(*magnitude).powi(2) * one_sided_factor(fft, bin) / denominator;
                    power.sqrt() as f32
                })
                .collect()
        })
        .collect();
    Ok((magnitudes, frames))
}

/// The window coefficients for `kind`: symmetric, with the `n - 1` denominator
/// `oxiaudio`'s generator uses.
fn window_coefficients(kind: WindowKind, n: usize) -> Vec<f64> {
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        return vec![1.0];
    }
    let n_minus_1 = (n - 1) as f64;
    let tau = std::f64::consts::TAU;
    (0..n)
        .map(|i| {
            let x = tau * i as f64 / n_minus_1;
            match kind {
                WindowKind::Rectangular => 1.0,
                WindowKind::Hann => 0.5 - 0.5 * x.cos(),
                WindowKind::Hamming => 0.54 - 0.46 * x.cos(),
                WindowKind::Blackman => 0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos(),
            }
        })
        .collect()
}

/// Coherent gain (Σ w) used to normalize the amplitude path.
fn window_gain(kind: WindowKind, n: usize) -> f64 {
    if n == 0 {
        return 1.0;
    }
    window_coefficients(kind, n).iter().sum()
}

/// Energy gain (Σ w²) used by the Parseval-normalized power path.
fn window_energy(kind: WindowKind, n: usize) -> f64 {
    let energy: f64 = window_coefficients(kind, n)
        .iter()
        .map(|coefficient| coefficient * coefficient)
        .sum();
    if energy > 0.0 {
        energy
    } else {
        n.max(1) as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn params(fft: usize, window_fn: WindowKind) -> SharedParams {
        SharedParams {
            fft_size: fft,
            hop: 1.0,
            randomized_overlap: false,
            window_fn,
            channel: None,
            resample_to: None,
            freq_min_hz: 0.0,
            freq_max_hz: 0.0,
        }
    }

    type StftPass = fn(
        &[f32],
        u32,
        usize,
        usize,
        &SharedParams,
    ) -> Result<(Vec<Vec<f32>>, usize), AnalysisError>;

    /// Run one STFT pass over a single-window signal and return its only frame.
    fn one_frame(pass: StftPass, signal: &[f32], p: &SharedParams) -> Vec<f32> {
        let (mut frames, count) = pass(signal, RATE, p.fft_size, p.fft_size, p).expect("stft");
        assert_eq!(count, 1, "expected a single frame");
        frames.pop().expect("one frame")
    }

    fn bin_sine(fft: usize, bin: usize) -> Vec<f32> {
        let hz = bin as f32 * RATE as f32 / fft as f32;
        (0..fft)
            .map(|i| (std::f32::consts::TAU * hz * i as f32 / RATE as f32).sin())
            .collect()
    }

    #[test]
    fn the_power_stft_conserves_the_frame_mean_square() {
        let fft = 1024;
        // A deterministic broad-band signal: one frame of exactly `fft` samples.
        let signal: Vec<f32> = (0..fft)
            .map(|i| ((i * 37 % 101) as f32 / 50.0) - 1.0)
            .collect();
        let p = params(fft, WindowKind::Rectangular);
        let frame = one_frame(stft_power_magnitudes, &signal, &p);
        let mean_square: f64 =
            signal.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() / fft as f64;
        let total: f64 = frame.iter().map(|m| f64::from(*m).powi(2)).sum();
        assert!(
            (total - mean_square).abs() <= mean_square * 1e-3,
            "Σm² = {total}, mean square = {mean_square}"
        );
    }

    #[test]
    fn the_power_stft_reads_a_full_scale_sine_at_minus_three_dbfs() {
        let fft = 1024;
        let bin = 64;
        let p = params(fft, WindowKind::Rectangular);
        let frame = one_frame(stft_power_magnitudes, &bin_sine(fft, bin), &p);
        // A sine's mean square is A²/2 = 0.5, carried once by the doubled one-sided bin.
        let total: f64 = frame.iter().map(|m| f64::from(*m).powi(2)).sum();
        assert!((total - 0.5).abs() < 1e-3, "Σm² = {total}");
        let peak = frame.iter().copied().fold(0.0f32, f32::max);
        assert!(
            (20.0 * f64::from(peak).log10() + 3.01).abs() < 0.02,
            "peak RMS = {peak} ({:.2} dBFS)",
            20.0 * f64::from(peak).log10()
        );
    }

    #[test]
    fn dc_and_nyquist_bins_take_a_unit_factor() {
        let fft = 1024;
        let p = params(fft, WindowKind::Rectangular);

        let dc = vec![1.0f32; fft];
        let amplitude = one_frame(stft_magnitudes, &dc, &p);
        assert!((amplitude[0] - 1.0).abs() < 1e-4, "DC = {}", amplitude[0]);
        let power = one_frame(stft_power_magnitudes, &dc, &p);
        assert!((power[0] - 1.0).abs() < 1e-4, "DC RMS = {}", power[0]);

        let nyquist: Vec<f32> = (0..fft)
            .map(|i| if i.is_multiple_of(2) { 1.0 } else { -1.0 })
            .collect();
        let amplitude = one_frame(stft_magnitudes, &nyquist, &p);
        assert!(
            (amplitude[fft / 2] - 1.0).abs() < 1e-4,
            "Nyquist amp = {}",
            amplitude[fft / 2]
        );
        assert!(amplitude[0].abs() < 1e-4, "DC leaked: {}", amplitude[0]);
        let power = one_frame(stft_power_magnitudes, &nyquist, &p);
        assert!(
            (power[fft / 2] - 1.0).abs() < 1e-4,
            "Nyquist power = {}",
            power[fft / 2]
        );
    }

    #[test]
    fn an_interior_sine_still_reads_its_amplitude() {
        let fft = 1024;
        let bin = 64;
        let p = params(fft, WindowKind::Rectangular);
        let amplitude = one_frame(stft_magnitudes, &bin_sine(fft, bin), &p);
        assert!(
            (amplitude[bin] - 1.0).abs() < 1e-3,
            "interior |X| = {}",
            amplitude[bin]
        );
    }
}
