//! Signal helpers shared by the analysis tools: buffer adapters, frame grids, the
//! STFT magnitude pass, and the series / matrix / envelope builders the tools use
//! to shape their results.

use oxiaudio::dsp::spectral::stft;
use oxiaudio::dsp::PitchFrame;
use oxiaudio::{AudioBuffer, ChannelLayout, SampleFormat};

use super::{
    AnalysisError, MatrixResult, PitchResult, SeriesResult, SharedParams, WindowKind, DB_FLOOR,
    MAX_PITCH_FRAMES, MAX_RHYTHM_FRAMES, MAX_STFT_CELLS,
};

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
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
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
pub(super) fn pitch_series(frames: Vec<PitchFrame>, hop: usize, sample_rate: u32) -> PitchResult {
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
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        voiced_frames,
        voiced_fraction: if frames_count == 0 {
            0.0
        } else {
            voiced_frames as f32 / frames_count as f32
        },
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
        bands: (0..bins).map(|i| i as f32).collect(),
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
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

/// STFT magnitudes per frame (`frames[t][k]`, `k` in `0..=fft/2`).
///
/// When `randomized_overlap` is set, a second STFT is taken half a hop off and the
/// magnitudes are averaged in, breaking the fixed frame-grid alignment (the
/// `stft` batch API exposes no jitter option itself).
pub(super) fn stft_magnitudes(
    mono: &[f32],
    sample_rate: u32,
    fft: usize,
    hop: usize,
    params: &SharedParams,
) -> Result<(Vec<Vec<f32>>, usize), AnalysisError> {
    let bins = fft / 2 + 1;
    let window = params.window_fn.to_window_fn();
    // Scale magnitudes so a full-scale sine peaks near 0 dBFS regardless of the
    // FFT size / window (`stft` returns unnormalized transform output).
    let gain = (2.0 / window_gain(params.window_fn, fft)) as f32;

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
                    .map(|c| (c.re * c.re + c.im * c.im).sqrt() * gain)
                    .collect()
            })
            .collect())
    };

    // Zero-pad a window shorter than the FFT so it still yields one frame.
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

/// Coherent gain (∑ of the window coefficients) for the standard window formulas,
/// used to normalize STFT magnitudes to an amplitude scale.
pub(super) fn window_gain(kind: WindowKind, n: usize) -> f64 {
    if n == 0 {
        return 1.0;
    }
    let n_minus_1 = (n - 1).max(1) as f64;
    let tau = std::f64::consts::TAU;
    match kind {
        WindowKind::Rectangular => n as f64,
        WindowKind::Hann => (0..n)
            .map(|i| 0.5 - 0.5 * (tau * i as f64 / n_minus_1).cos())
            .sum(),
        WindowKind::Hamming => (0..n)
            .map(|i| 0.54 - 0.46 * (tau * i as f64 / n_minus_1).cos())
            .sum(),
        WindowKind::Blackman => (0..n)
            .map(|i| {
                let x = tau * i as f64 / n_minus_1;
                0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos()
            })
            .sum(),
    }
}

/// Min/max envelope over `samples`, targeting `buckets` buckets.
pub(super) fn envelope(samples: &[f32], buckets: usize) -> (Vec<f32>, Vec<f32>) {
    if samples.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let step = samples.len().div_ceil(buckets.max(1)).max(1);
    let count = samples.len().div_ceil(step);
    let mut min = Vec::with_capacity(count);
    let mut max = Vec::with_capacity(count);
    for chunk in samples.chunks(step) {
        let mut lo = 1.0f32;
        let mut hi = -1.0f32;
        for &value in chunk {
            if value < lo {
                lo = value;
            }
            if value > hi {
                hi = value;
            }
        }
        if lo > hi {
            lo = 0.0;
            hi = 0.0;
        }
        min.push(lo);
        max.push(hi);
    }
    (min, max)
}
