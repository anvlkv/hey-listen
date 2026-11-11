//! Signal helpers shared by the analysis tools: buffer adapters, frame grids, the
//! STFT magnitude pass, and the series / matrix / envelope builders the tools use
//! to shape their results.

use oxiaudio::dsp::PitchFrame;
use oxiaudio::{AudioBuffer, ChannelLayout, SampleFormat};

use super::{
    AnalysisError, MatrixResult, PitchResult, SeriesResult, SharedParams, DB_FLOOR,
    MAX_FRAME_RMS_FRAMES, MAX_PITCH_FRAMES, MAX_RHYTHM_FRAMES, MAX_STFT_CELLS,
    MIN_RELIABLE_VOICED_FRAMES,
};

mod stft;

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
pub(super) fn onset_envelope(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> (usize, Vec<f32>) {
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let min_hop = mono.len().div_ceil(MAX_RHYTHM_FRAMES).max(1);
    let hop = hop.max(min_hop);
    let buf = mono_buffer(mono, sample_rate);
    let env = oxiaudio::dsp::spectral::spectral_flux(&buf, fft, hop);
    (hop, env)
}

/// Frame start times (seconds) for `frames` frames at `hop` samples.
pub(super) fn frame_times(frames: usize, hop: usize, sample_rate: u32) -> Vec<f32> {
    let dt = hop.max(1) as f32 / sample_rate.max(1) as f32;
    (0..frames).map(|i| i as f32 * dt).collect()
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
pub(super) fn frame_rms(
    mono: &[f32],
    sample_rate: u32,
    frame_ms: f32,
    hop_ms: f32,
) -> (Vec<f32>, Vec<f32>, usize, usize) {
    let rate = f64::from(sample_rate.max(1));
    let frame = ((f64::from(frame_ms) / 1000.0) * rate).round().max(1.0) as usize;
    let requested_hop = ((f64::from(hop_ms) / 1000.0) * rate).round().max(1.0) as usize;
    let hop = requested_hop.max(mono.len().div_ceil(MAX_FRAME_RMS_FRAMES).max(1));

    let len = mono.len();
    let mut times = Vec::new();
    let mut values = Vec::new();
    let mut start = 0usize;
    while start < len {
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
    }
    (times, values, frame, hop)
}

pub(super) fn build_series(
    times: Vec<f32>,
    values: Vec<Option<f32>>,
    hop: usize,
    sample_rate: u32,
) -> SeriesResult {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
    }
    SeriesResult {
        sample_rate,
        hop_size: hop,
        frames: values.len(),
        times,
        // Filled in by `run_window` — the builders only see the sliced region.
        window_start: 0.0,
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        frame_size: None,
        gate: None,
    }
}

/// Wrap one `f32` value per frame (non-finite values become gaps).
pub(super) fn series_from_vec(values: Vec<f32>, hop: usize, sample_rate: u32) -> SeriesResult {
    let times = frame_times(values.len(), hop, sample_rate);
    let values = values
        .into_iter()
        .map(|value| value.is_finite().then_some(value))
        .collect();
    build_series(times, values, hop, sample_rate)
}

/// Wrap a pitch track: unvoiced frames become gaps, times come from the tracker,
/// plus the voiced-frame summary so a nearly-empty track is visible at a glance.
/// `range` is the f0 search window the detector actually used, in Hz.
pub(super) fn pitch_series(
    frames: Vec<PitchFrame>,
    hop: usize,
    sample_rate: u32,
    range: (f32, f32),
) -> PitchResult {
    let times: Vec<f32> = frames
        .iter()
        .map(|frame| frame.time_seconds as f32)
        .collect();
    let values: Vec<Option<f32>> = frames
        .iter()
        .map(|frame| {
            (frame.is_voiced && frame.frequency_hz.is_finite() && frame.frequency_hz > 0.0)
                .then_some(frame.frequency_hz)
        })
        .collect();
    // Parallel to `values`: the confidence of every voiced frame, gap elsewhere.
    let confidence: Vec<Option<f32>> = values
        .iter()
        .zip(&frames)
        .map(|(value, frame)| value.map(|_| frame.confidence))
        .collect();
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut voiced_frames = 0usize;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
        voiced_frames += 1;
    }
    let frames_count = values.len();
    PitchResult {
        sample_rate,
        hop_size: hop,
        frames: frames_count,
        times,
        // Filled in by `run_window` — the builder only sees the sliced region.
        window_start: 0.0,
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        effective_min_f0_hz: range.0,
        effective_max_f0_hz: range.1,
        voiced_frames,
        voiced_fraction: if frames_count == 0 {
            0.0
        } else {
            voiced_frames as f32 / frames_count as f32
        },
        f0_reliable: voiced_frames >= MIN_RELIABLE_VOICED_FRAMES,
        confidence,
        // Only pYIN reports candidates; its dispatcher fills these in.
        candidates: None,
        octave_ambiguous: Vec::new(),
    }
}

/// Flatten a `frames × bands` matrix into a [`MatrixResult`].
pub(super) fn build_matrix(frames: Vec<Vec<f32>>, hop: usize, sample_rate: u32) -> MatrixResult {
    let n_frames = frames.len();
    let bins = frames.first().map(Vec::len).unwrap_or(0);
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut values = Vec::with_capacity(n_frames * bins);
    for frame in &frames {
        for &value in frame {
            let value = if value.is_finite() { value } else { 0.0 };
            min = min.min(value);
            max = max.max(value);
            values.push(value);
        }
    }
    MatrixResult {
        sample_rate,
        hop_size: hop,
        frames: n_frames,
        bins,
        duration: seconds(n_frames * hop.max(1), sample_rate) as f32,
        times: frame_times(n_frames, hop, sample_rate),
        // Filled in by `run_window` — the builder only sees the sliced region.
        window_start: 0.0,
        bands: (0..bins).map(|i| i as f32).collect(),
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        ..Default::default()
    }
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
