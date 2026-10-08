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
pub fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || from == 0 || to == 0 || input.is_empty() {
        return input.to_vec();
    }

    let ratio = to as f64 / from as f64;
    let out_len = ((input.len() as f64) * ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(out_len);
    let step = from as f64 / to as f64;

    for i in 0..out_len {
        let pos = i as f64 * step;
        let index = pos.floor() as usize;
        let frac = (pos - index as f64) as f32;
        let a = input[index.min(input.len() - 1)];
        let b = input[(index + 1).min(input.len() - 1)];
        output.push(a + (b - a) * frac);
    }

    output
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
}
