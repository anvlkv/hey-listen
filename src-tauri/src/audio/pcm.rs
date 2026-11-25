//! Small PCM helpers shared by the preview path: channel selection (mixdown) and
//! linear resampling to the output device's rate.

/// Reduce interleaved PCM to mono: either the average of every channel (`pick`
/// is `None`, the "downmix") or a single 0-based channel (`Some(n)`).
pub fn mixdown(interleaved: &[f32], channels: usize, pick: Option<usize>) -> Vec<f32> {
    let channels = channels.max(1);
    (0..interleaved.len() / channels)
        .map(|frame| mixdown_frame(interleaved, channels, frame, pick))
        .collect()
}

/// One frame of interleaved PCM reduced to mono by `pick` — the per-sample form of
/// [`mixdown`], for a caller that feeds a graph frame by frame.
///
/// A `pick` the buffer does not have falls back to the downmix, so a channel number
/// from a graph that outlives its source (`Ch 3` on a stereo file) still makes sound.
pub fn mixdown_frame(
    interleaved: &[f32],
    channels: usize,
    frame: usize,
    pick: Option<usize>,
) -> f32 {
    let channels = channels.max(1);
    let base = frame * channels;
    match pick {
        Some(channel) if channel < channels => interleaved[base + channel],
        _ => {
            let inv = 1.0 / channels as f32;
            let mut sum = 0.0;
            for c in 0..channels {
                sum += interleaved[base + c];
            }
            sum * inv
        }
    }
}

/// Linear-interpolating resample of mono PCM. Returns the input unchanged when
/// the rates match.
///
/// Downsampling (`to < from`) first passes the signal through an anti-alias
/// low-pass just below the **new** Nyquist, so content above it is attenuated
/// rather than folded back into the band; the existing linear interpolation then
/// samples the filtered signal. Upsampling and matching rates stay with plain
/// linear interpolation (which is itself a mild low-pass).
pub fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || from == 0 || to == 0 || input.is_empty() {
        return input.to_vec();
    }

    let filtered;
    let source: &[f32] = if to < from {
        filtered = anti_alias_lowpass(input, from, to);
        &filtered
    } else {
        input
    };

    let ratio = to as f64 / from as f64;
    let out_len = ((input.len() as f64) * ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(out_len);
    let step = from as f64 / to as f64;

    for i in 0..out_len {
        let pos = i as f64 * step;
        let index = pos.floor() as usize;
        let frac = (pos - index as f64) as f32;
        let a = source[index.min(source.len() - 1)];
        let b = source[(index + 1).min(source.len() - 1)];
        output.push(a + (b - a) * frac);
    }

    output
}

/// Quantise an `f32` sample to the project file's i16 convention.
///
/// Clamped to `[-1, 1]` first: scaling by `32767` keeps `+1.0` inside an `i16`, while
/// the matching [`dequantize_i16`] divides by `32768`, so the error stays below one
/// least-significant bit and silence round-trips exactly.
pub fn quantize_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

/// Restore an `i16` sample to `f32` (see [`quantize_i16`]).
pub fn dequantize_i16(value: i16) -> f32 {
    f32::from(value) / 32768.0
}

/// Blackman-windowed sinc low-pass applied before decimation.
///
/// The cutoff is 90% of the target Nyquist; the tap count is chosen so the
/// window's transition band reaches (about) that Nyquist — a Blackman window needs
/// roughly `5.5 / transition-width` taps. Taps are capped at 1023 so extreme ratios
/// stay bounded (the transition then ends slightly above the target Nyquist). Edge
/// samples are replicated, which keeps DC and the passband amplitude intact.
fn anti_alias_lowpass(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    let ratio = f64::from(to) / f64::from(from);
    // 0.45 of the input rate is 0.9 × the new Nyquist (0.5 × ratio).
    let cutoff = 0.45 * ratio;
    let taps = ((5.5 / (0.05 * ratio)).ceil() as usize).clamp(15, 1023) | 1;
    let half = taps / 2;
    let half_f = half as f64;

    let mut kernel: Vec<f64> = (0..taps)
        .map(|index| {
            let offset = index as isize - half as isize;
            let x = offset as f64;
            let sinc = if offset == 0 {
                1.0
            } else {
                let argument = std::f64::consts::PI * 2.0 * cutoff * x;
                argument.sin() / argument
            };
            let angle = std::f64::consts::PI * x / half_f;
            let window = 0.42 + 0.5 * angle.cos() + 0.08 * (2.0 * angle).cos();
            sinc * window
        })
        .collect();
    let sum: f64 = kernel.iter().sum();
    for coefficient in &mut kernel {
        *coefficient /= sum;
    }

    let last = input.len().saturating_sub(1) as isize;
    input
        .iter()
        .enumerate()
        .map(|(index, _)| {
            let mut acc = 0.0f64;
            for (tap, &coefficient) in kernel.iter().enumerate() {
                let offset = index as isize + tap as isize - half as isize;
                let sample = input[offset.clamp(0, last) as usize];
                acc += f64::from(sample) * coefficient;
            }
            acc as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantize_clamps_at_full_scale() {
        assert_eq!(quantize_i16(1.0), 32767);
        assert_eq!(quantize_i16(-1.0), -32767);
        // Out-of-range input cannot wrap: it clamps like full scale.
        assert_eq!(quantize_i16(2.0), 32767);
        assert_eq!(quantize_i16(-3.0), -32767);
    }

    #[test]
    fn silence_round_trips_exactly() {
        assert_eq!(quantize_i16(0.0), 0);
        assert_eq!(dequantize_i16(0), 0.0);
    }

    #[test]
    fn dequantize_uses_the_half_scale_denominator() {
        // The 32767 / 32768 asymmetry keeps ±1 inside an `i16`.
        assert_eq!(dequantize_i16(32767), 32767.0 / 32768.0);
        assert_eq!(dequantize_i16(-32767), -32767.0 / 32768.0);
        assert_eq!(dequantize_i16(i16::MIN), -1.0);
    }

    #[test]
    fn mixdown_averages_channels() {
        let stereo = vec![1.0, 0.0, 0.0, 1.0];
        assert_eq!(mixdown(&stereo, 2, None), vec![0.5, 0.5]);
    }

    #[test]
    fn mixdown_selects_a_channel() {
        let stereo = vec![1.0, 0.0, 0.0, 1.0];
        assert_eq!(mixdown(&stereo, 2, Some(1)), vec![0.0, 1.0]);
    }

    #[test]
    fn resample_preserves_dc() {
        let dc = vec![0.7f32; 100];
        let out = resample_linear(&dc, 48_000, 44_100);
        assert!(out.len() > 90 && out.len() < 100);
        for value in out {
            assert!((value - 0.7).abs() < 1e-5);
        }
    }

    fn cosine(hz: f32, seconds: f32, rate: u32) -> Vec<f32> {
        let frames = (seconds * rate as f32) as usize;
        (0..frames)
            .map(|i| (std::f32::consts::TAU * hz * i as f32 / rate as f32).cos())
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        let energy: f32 = samples.iter().map(|value| value * value).sum();
        (energy / samples.len() as f32).sqrt()
    }

    #[test]
    fn resample_rejects_content_above_the_new_nyquist() {
        // 18 kHz at 48 kHz would alias to 6 kHz at 24 kHz with RMS ≈ 0.707 if the
        // decimation were not band-limited.
        let input = cosine(18_000.0, 0.5, 48_000);
        let out = resample_linear(&input, 48_000, 24_000);
        let steady = &out[out.len() / 4..3 * out.len() / 4];
        let level = rms(steady);
        assert!(level < 0.01, "aliased 18 kHz kept RMS {level}");
    }

    #[test]
    fn resample_keeps_the_passband_amplitude() {
        let input = cosine(1_000.0, 0.5, 48_000);
        let out = resample_linear(&input, 48_000, 24_000);
        let steady = &out[out.len() / 4..3 * out.len() / 4];
        let level = rms(steady);
        assert!(
            (level - 1.0 / 2f32.sqrt()).abs() < 0.02,
            "passband RMS {level}, expected 0.707"
        );
    }
}
