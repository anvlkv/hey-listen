//! Helpers shared by the frame-based matrix tools (`criticalBands`, `loudness`):
//! the shared STFT with its bin frequencies, the band-limited variant the spectrum
//! overlays use, the band-matrix result builder, and the series extents helper.

use super::super::support::{
    effective_hop, effective_params, frame_times, seconds, stft_magnitudes, stft_power_magnitudes,
};
use super::super::{AnalysisError, MatrixResult, SharedParams};

/// The shared STFT: `(hop samples, per-frame magnitudes, per-bin frequencies)`.
type StftFrames = (usize, Vec<Vec<f32>>, Vec<f32>);

/// An STFT restricted to the requested frequency band.
pub(super) struct BandStft {
    pub fft: usize,
    pub hop: usize,
    pub frames: usize,
    /// The retained bin indices into every frame's magnitude vector.
    pub bins: Vec<usize>,
    /// The retained bin centre frequencies (Hz).
    pub freqs: Vec<f32>,
    pub magnitudes: Vec<Vec<f32>>,
}

/// The shared STFT and its bin centre frequencies.
///
/// Returns **energy-conserving** magnitudes meant for power/energy consumers
/// (`criticalBands`, `loudness`): `m[k]` is an RMS-equivalent component, so
/// `Σ m[k]²` is the frame mean square and a full-scale sine reads −3.01 dBFS RMS
/// (see `support::stft_power_magnitudes`). The amplitude/spectrum path keeps
/// `stft_magnitudes` instead.
pub(super) fn stft_with_freqs(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<StftFrames, AnalysisError> {
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (magnitudes, _) = stft_power_magnitudes(mono, sample_rate, fft, hop, params)?;
    let bins = fft / 2 + 1;
    let freqs = (0..bins)
        .map(|bin| bin as f32 * sample_rate as f32 / fft as f32)
        .collect();
    Ok((hop, magnitudes, freqs))
}

/// The shared STFT and its bin centre frequencies, using the **amplitude** path
/// (coherent-gain normalized), for consumers that read per-bin component levels
/// (e.g. the loudness model) rather than summing power across bins.
pub(super) fn stft_with_freqs_amplitude(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<StftFrames, AnalysisError> {
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (magnitudes, _) = stft_magnitudes(mono, sample_rate, fft, hop, params)?;
    let bins = fft / 2 + 1;
    let freqs = (0..bins)
        .map(|bin| bin as f32 * sample_rate as f32 / fft as f32)
        .collect();
    Ok((hop, magnitudes, freqs))
}

/// The shared STFT limited to the requested band, with the retained bin indices.
pub(super) fn band_stft(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<BandStft, AnalysisError> {
    let params = effective_params(params, sample_rate);
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (magnitudes, frames) = stft_magnitudes(mono, sample_rate, fft, hop, &params)?;
    let all_bins = fft / 2 + 1;
    let (min_hz, max_hz) = params.band(sample_rate);
    let mut bins = Vec::new();
    let mut freqs = Vec::new();
    for k in 0..all_bins {
        let hz = k as f64 * f64::from(sample_rate) / fft as f64;
        if hz < min_hz || hz > max_hz {
            continue;
        }
        bins.push(k);
        freqs.push(hz as f32);
    }
    Ok(BandStft {
        fft,
        hop,
        frames,
        bins,
        freqs,
        magnitudes,
    })
}

/// The min/max of a gapped series' present values (`0` / `0` when it is empty).
pub(super) fn series_extents(values: &[Option<f32>]) -> (f32, f32) {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
    }
    (
        if min.is_finite() { min } else { 0.0 },
        if max.is_finite() { max } else { 0.0 },
    )
}

/// Flatten a frame × band grid into a [`MatrixResult`], labelling the columns with
/// `bands` (e.g. a band-centre frequency in Hz).
///
/// Non-finite cells become `0.0`, like every other matrix builder.
pub(super) fn build_band_matrix(
    frames: &[Vec<f32>],
    bands: Vec<f32>,
    hop: usize,
    sample_rate: u32,
) -> MatrixResult {
    let bins = bands.len();
    let values: Vec<f32> = frames
        .iter()
        .flat_map(|frame| {
            (0..bins)
                .map(|index| {
                    frame
                        .get(index)
                        .copied()
                        .filter(|value| value.is_finite())
                        .unwrap_or(0.0)
                })
                .collect::<Vec<f32>>()
        })
        .collect();
    MatrixResult {
        sample_rate,
        hop_size: hop,
        frames: frames.len(),
        bins,
        duration: seconds(frames.len() * hop.max(1), sample_rate) as f32,
        times: frame_times(frames.len(), hop, sample_rate),
        // Filled in by `run_window` — the builder only sees the sliced region.
        window_start: 0.0,
        bands,
        min_value: values.iter().copied().reduce(f32::min).unwrap_or(0.0),
        max_value: values.iter().copied().reduce(f32::max).unwrap_or(0.0),
        values,
    }
}
