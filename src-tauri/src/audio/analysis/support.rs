//! Signal helpers shared by the analysis tools: buffer adapters, frame grids, the
//! STFT magnitude pass, and the series / matrix / envelope builders the tools use
//! to shape their results. The builders live in [`series`].

use oxiaudio::{AudioBuffer, ChannelLayout, SampleFormat};

use super::{
    AnalysisError, AnalysisResult, Cancel, SharedParams, ToolOptions, CANCEL_STRIDE, DB_FLOOR,
    MAX_FRAME_RMS_FRAMES, MAX_PITCH_FRAMES, MAX_RHYTHM_FRAMES, MAX_STFT_CELLS,
};

mod series;
mod stft;

pub(super) use series::{build_matrix, build_series, pitch_series, series_from_vec};
pub(super) use stft::{stft_magnitudes, stft_power_magnitudes};

/// Build a mono `oxiaudio` buffer view over `samples`.
pub(super) fn mono_buffer(samples: &[f32], sample_rate: u32) -> AudioBuffer<f32> {
    AudioBuffer {
        samples: samples.to_vec(),
        sample_rate: sample_rate.max(1),
        channels: ChannelLayout::Mono,
        format: SampleFormat::F32,
    }
}

/// dBFS clamped to [`DB_FLOOR`] so silence serializes to a finite number.
pub(super) fn db_or_floor(db: f32) -> f32 {
    if db.is_finite() {
        db.max(DB_FLOOR)
    } else {
        DB_FLOOR
    }
}

pub(super) fn seconds(frames: usize, sample_rate: u32) -> f64 {
    if sample_rate > 0 {
        frames as f64 / f64::from(sample_rate)
    } else {
        0.0
    }
}

/// The `(fft, hop)` grid a frame-based tool should use for this signal.
pub(super) fn frame_grid(len: usize, params: &SharedParams) -> (usize, usize) {
    let fft = params.fft_size();
    let hop = effective_hop(fft, len, params.hop_size(fft));
    (fft, hop)
}

/// Zero-pad `mono` up to `fft` samples. The library's frame-based features (unlike
/// our STFT) do not pad, so a window shorter than the FFT would otherwise yield no
/// frames at all — padding keeps them (and the pitch trackers) non-empty.
pub(super) fn pad_to_fft(mono: &[f32], fft: usize) -> Vec<f32> {
    let mut buffer = vec![0.0f32; fft];
    let n = mono.len().min(fft);
    buffer[..n].copy_from_slice(&mono[..n]);
    buffer
}

/// The frame grid for the O(frames × lags) tools (pitch, harmonic ratio): like
/// [`frame_grid`], but the hop is widened so the frame count never exceeds
/// [`MAX_PITCH_FRAMES`], keeping a long window interactive.
pub(super) fn pitch_grid(len: usize, params: &SharedParams) -> (usize, usize) {
    let fft = params.fft_size();
    let hop = effective_hop(fft, len, params.hop_size(fft));
    let min_hop = len.div_ceil(MAX_PITCH_FRAMES).max(1);
    (fft, hop.max(min_hop))
}

/// The onset-strength envelope for the rhythm tools: half-wave-rectified spectral
/// flux per frame, with the hop widened so the frame count stays bounded.
///
/// `spectral_flux` is one `oxiaudio` call, so the token is checked on either side of
/// it rather than inside it.
pub(super) fn onset_envelope(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    cancel: &Cancel,
) -> Result<(usize, Vec<f32>), AnalysisError> {
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let min_hop = mono.len().div_ceil(MAX_RHYTHM_FRAMES).max(1);
    let hop = hop.max(min_hop);
    let buf = mono_buffer(mono, sample_rate);
    cancel.check()?;
    let env = oxiaudio::dsp::spectral::spectral_flux(&buf, fft, hop);
    cancel.check()?;
    Ok((hop, env))
}

/// Frame start times (seconds) for `frames` frames at `hop` samples.
pub(super) fn frame_times(frames: usize, hop: usize, sample_rate: u32) -> Vec<f32> {
    let dt = hop.max(1) as f32 / sample_rate.max(1) as f32;
    (0..frames).map(|i| i as f32 * dt).collect()
}

/// `ms` of audio as a rounded sample count at `sample_rate` (at least one sample).
fn ms_to_samples(ms: f32, sample_rate: u32) -> usize {
    ((f64::from(ms) / 1000.0) * f64::from(sample_rate.max(1)))
        .round()
        .max(1.0) as usize
}

/// Frame-centred RMS envelope: `(times_secs, levels_db, frame_samples, hop_samples)`.
///
/// Frames start at 0 and advance by the effective hop; each level is the RMS of the
/// samples the frame actually covers, in dBFS (floored at [`DB_FLOOR`]), and each time
/// is that frame's **centre**. A signal shorter than one frame still yields one value
/// over the samples present.
///
/// Two consequences are reported rather than hidden. The final partial frame covers
/// fewer samples, so its centre sits closer to its predecessor than `hop`: consumers
/// must use `times`, not infer `i × hop`. And when the hop is widened to stay inside
/// [`MAX_FRAME_RMS_FRAMES`] (or the requested hop already exceeds the frame), frames
/// no longer tile the signal — samples between them are simply not measured.
///
/// The returned `(frame, hop)` are the **effective** samples-per-frame and
/// samples-per-hop; `frame` is the configured frame, so the final partial frame can be
/// shorter than the reported size.
///
/// The token is checked every [`CANCEL_STRIDE`] frames, so a long envelope stops early
/// when its run is superseded.
pub(super) fn frame_rms(
    mono: &[f32],
    sample_rate: u32,
    frame_ms: f32,
    hop_ms: f32,
    cancel: &Cancel,
) -> Result<(Vec<f32>, Vec<f32>, usize, usize), AnalysisError> {
    let frame = ms_to_samples(frame_ms, sample_rate);
    let requested_hop = ms_to_samples(hop_ms, sample_rate);
    let hop = requested_hop.max(mono.len().div_ceil(MAX_FRAME_RMS_FRAMES).max(1));

    let len = mono.len();
    let rate = f64::from(sample_rate.max(1));
    let mut times = Vec::new();
    let mut values = Vec::new();
    let mut start = 0usize;
    let mut index = 0usize;
    while start < len {
        if index.is_multiple_of(CANCEL_STRIDE) {
            cancel.check()?;
        }
        let end = (start + frame).min(len);
        let slice = &mono[start..end];
        let sum: f64 = slice.iter().map(|&sample| f64::from(sample).powi(2)).sum();
        let rms = (sum / slice.len() as f64).sqrt() as f32;
        let db = if rms > 0.0 {
            20.0 * rms.log10()
        } else {
            DB_FLOOR
        };
        let centre = (start as f64 + (end - start) as f64 / 2.0) / rate;
        times.push(centre as f32);
        values.push(db_or_floor(db));
        if end >= len {
            break;
        }
        start += hop;
        index += 1;
    }
    Ok((times, values, frame, hop))
}

/// The hop a `frameRms` result **asked for**, in samples, when the engine widened it to
/// stay inside [`MAX_FRAME_RMS_FRAMES`].
///
/// `hop_size` stays the effective hop, so the request is only recoverable from the
/// options; returning it here lets a response report the difference instead of leaving
/// the caller to infer it. Response-only — nothing is stored — and `None` for every other
/// tool and whenever the hop ran exactly as asked.
pub(crate) fn widened_hop_from(result: &AnalysisResult, options: &ToolOptions) -> Option<usize> {
    let AnalysisResult::FrameRms(series) = result else {
        return None;
    };
    let requested = ms_to_samples(options.hop_ms(), series.sample_rate);
    (requested < series.hop_size).then_some(requested)
}

pub(super) fn oxi_err(err: oxiaudio::OxiAudioError) -> AnalysisError {
    AnalysisError::Analysis(err.to_string())
}

/// The default band (`freq_max_hz ≤ 0`) is filled in with the Nyquist here so the
/// tools can band-limit without each re-deriving it.
pub(super) fn effective_params(params: &SharedParams, sample_rate: u32) -> SharedParams {
    let mut params = params.clone();
    if !(params.freq_max_hz.is_finite() && params.freq_max_hz > 0.0) {
        params.freq_max_hz = f64::from(sample_rate) / 2.0;
    }
    params
}

/// The hop actually used: the requested hop, raised if it would produce an
/// unbounded STFT frame matrix for a long window (the effective hop is reported
/// back in the result so the UI shows the truth).
pub(super) fn effective_hop(fft: usize, len: usize, requested: usize) -> usize {
    let requested = requested.max(1);
    if len <= fft {
        return requested;
    }
    let bins = fft / 2 + 1;
    let max_frames = (MAX_STFT_CELLS / bins).max(1);
    let needed = (len - fft).div_ceil(max_frames.saturating_sub(1).max(1));
    requested.max(needed)
}

/// The min/max envelope of `samples` plus the per-bucket level data the waveform view
/// uses, all aligned bucket-for-bucket.
///
/// The partition is `ceil(len / ceil(len / buckets))` contiguous chunks (the last one
/// can be shorter). Each bucket reports the extrema of **its own samples**, so
/// above-full-scale data keeps its real min/max instead of being clamped to ±1.
pub(super) struct Envelope {
    pub min: Vec<f32>,
    pub max: Vec<f32>,
    /// RMS of each bucket's own samples.
    pub rms: Vec<f32>,
    /// Buckets whose peak reaches full scale (`max >= 1` or `min <= -1`).
    pub clipped_buckets: usize,
}

/// Min/max envelope plus per-bucket RMS over `samples`, targeting `buckets` buckets.
pub(super) fn envelope(samples: &[f32], buckets: usize) -> Envelope {
    let mut envelope = Envelope {
        min: Vec::new(),
        max: Vec::new(),
        rms: Vec::new(),
        clipped_buckets: 0,
    };
    if samples.is_empty() {
        return envelope;
    }
    let step = samples.len().div_ceil(buckets.max(1)).max(1);
    let count = samples.len().div_ceil(step);
    envelope.min.reserve(count);
    envelope.max.reserve(count);
    envelope.rms.reserve(count);
    for chunk in samples.chunks(step) {
        let Some(&first) = chunk.first() else {
            continue;
        };
        let (mut lo, mut hi) = (first, first);
        let mut sum_squares = 0.0f64;
        for &value in chunk {
            if value < lo {
                lo = value;
            }
            if value > hi {
                hi = value;
            }
            sum_squares += f64::from(value).powi(2);
        }
        if hi >= 1.0 || lo <= -1.0 {
            envelope.clipped_buckets += 1;
        }
        envelope.min.push(lo);
        envelope.max.push(hi);
        envelope
            .rms
            .push((sum_squares / chunk.len() as f64).sqrt() as f32);
    }
    envelope
}

#[cfg(test)]
mod tests {
    use super::envelope;

    #[test]
    fn envelope_keeps_extrema_above_full_scale() {
        // A same-sign bucket above full scale must report its own extrema, not a
        // clamped ±1 pair invented by the seeding.
        let env = envelope(&[2.0, 3.0], 1);
        assert_eq!((env.min, env.max), (vec![2.0], vec![3.0]));
        let env = envelope(&[-3.0, -2.0], 1);
        assert_eq!((env.min, env.max), (vec![-3.0], vec![-2.0]));
        assert_eq!(env.clipped_buckets, 1);
    }

    #[test]
    fn envelope_extrema_use_only_the_samples_in_each_bucket() {
        // 4 samples over 2 buckets → `ceil(4 / ceil(4 / 2))` = 2 samples per bucket.
        let env = envelope(&[0.5, -0.25, 2.0, 3.0], 2);
        assert_eq!(env.min, vec![-0.25, 2.0]);
        assert_eq!(env.max, vec![0.5, 3.0]);
        // Each bucket's RMS is over its own two samples.
        assert!((env.rms[0] - (0.3125f32 / 2.0).sqrt()).abs() < 1e-6);
        assert!((env.rms[1] - (13.0f32 / 2.0).sqrt()).abs() < 1e-6);
        // Only the second bucket's peak reaches full scale.
        assert_eq!(env.clipped_buckets, 1);
    }
}
