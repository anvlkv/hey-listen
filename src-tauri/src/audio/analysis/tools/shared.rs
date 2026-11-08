//! Helpers shared by the frame-based matrix tools (`criticalBands`, `loudness`):
//! the shared STFT with its bin frequencies, and the band-matrix result builder.

use super::super::support::{effective_hop, frame_times, seconds, stft_magnitudes};
use super::super::{AnalysisError, MatrixResult, SharedParams};

/// The shared STFT: `(hop samples, per-frame magnitudes, per-bin frequencies)`.
type StftFrames = (usize, Vec<Vec<f32>>, Vec<f32>);

/// The shared STFT and its bin centre frequencies.
pub(super) fn stft_with_freqs(
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
