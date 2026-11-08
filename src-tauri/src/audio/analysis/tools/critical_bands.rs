//! The `criticalBands` analyzer (M26): STFT magnitude integrated into Bark or
//! ERB critical bands, returned as a frame × band energy matrix.

use super::super::psychoacoustics::bands::{band_energies, critical_band_edges};
use super::super::support::{effective_hop, frame_times, stft_magnitudes};
use super::super::{AnalysisError, MatrixResult, SharedParams, ToolOptions};

/// Integrate the shared STFT magnitude into critical bands.
///
/// The band axis is the band-centre frequency in Hz (not a row index), so the
/// matrix view labels each row in Hz and the export headers carry the centres.
pub(super) fn critical_bands(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MatrixResult, AnalysisError> {
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (magnitudes, _) = stft_magnitudes(mono, sample_rate, fft, hop, params)?;

    let bins = fft / 2 + 1;
    let freqs: Vec<f32> = (0..bins)
        .map(|bin| bin as f32 * sample_rate as f32 / fft as f32)
        .collect();

    let (min_hz, max_hz) = params.band(sample_rate);
    let edges = critical_band_edges(options.scale(), min_hz as f32, max_hz as f32);
    let centres: Vec<f32> = edges
        .windows(2)
        .map(|pair| (pair[0] + pair[1]) / 2.0)
        .collect();

    let energies = band_energies(&magnitudes, &freqs, &edges);
    let frames = energies.len();
    let bands = centres.len();

    let mut values = Vec::with_capacity(frames * bands);
    let (mut min_value, mut max_value) = (f32::INFINITY, f32::NEG_INFINITY);
    for frame in &energies {
        for &energy in frame.iter().take(bands) {
            // Non-finite energies become 0.0, like every other matrix builder.
            let value = if energy.is_finite() { energy } else { 0.0 };
            min_value = min_value.min(value);
            max_value = max_value.max(value);
            values.push(value);
        }
    }

    Ok(MatrixResult {
        sample_rate,
        hop_size: hop,
        frames,
        bins: bands,
        duration: (frames * hop) as f32 / sample_rate.max(1) as f32,
        times: frame_times(frames, hop, sample_rate),
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        bands: centres,
        values,
        min_value: if min_value.is_finite() {
            min_value
        } else {
            0.0
        },
        max_value: if max_value.is_finite() {
            max_value
        } else {
            0.0
        },
    })
}
