//! Small PCM helpers shared by the preview path: channel selection (mixdown) and
//! linear resampling to the output device's rate.

/// Reduce interleaved PCM to mono: either the average of every channel (`pick`
/// is `None`, the "downmix") or a single 0-based channel (`Some(n)`).
pub fn mixdown(interleaved: &[f32], channels: usize, pick: Option<usize>) -> Vec<f32> {
    let channels = channels.max(1);
    let frames = interleaved.len() / channels;
    let mut mono = Vec::with_capacity(frames);

    match pick {
        Some(channel) if channel < channels => {
            for frame in 0..frames {
                mono.push(interleaved[frame * channels + channel]);
            }
        }
        _ => {
            let inv = 1.0 / channels as f32;
            for frame in 0..frames {
                let base = frame * channels;
                let mut sum = 0.0;
                for c in 0..channels {
                    sum += interleaved[base + c];
                }
                mono.push(sum * inv);
            }
        }
    }

    mono
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
