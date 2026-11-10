//! The `criticalBands` analyzer (M26): STFT power integrated into Bark or ERB
//! critical bands, returned as a frame × band matrix.

use super::super::psychoacoustics::bands::{band_energies, critical_band_edges};
use super::super::{AnalysisError, MatrixResult, SharedParams, ToolOptions};
use super::shared::{build_band_matrix, stft_with_freqs};

/// Integrate the shared STFT power into critical bands.
///
/// The band axis (`MatrixResult::bands`) holds each band's **centre frequency in
/// Hz**, not a row index, so the matrix view labels each row in Hz and the export
/// headers carry the centres. The edges are regenerated from the requested
/// `[freqMinHz, freqMaxHz]` range by [`critical_band_edges`], so changing the range
/// moves the partition (and can change the band count) — these are not the fixed
/// standardized Bark/ERB boundaries.
///
/// Values are each band's **summed spectral power** relative to digital full scale,
/// expressed in dBFS (`20 log10 sqrt(Σ m²)`). They are not joules or an energy
/// density, and not a power spectral density in dB/Hz.
pub(super) fn critical_bands(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MatrixResult, AnalysisError> {
    let (hop, magnitudes, freqs) = stft_with_freqs(mono, sample_rate, params)?;

    let (min_hz, max_hz) = params.band(sample_rate);
    let edges = critical_band_edges(options.scale(), min_hz as f32, max_hz as f32);
    let centres: Vec<f32> = edges
        .windows(2)
        .map(|pair| (pair[0] + pair[1]) / 2.0)
        .collect();

    let energies = band_energies(&magnitudes, &freqs, &edges);
    let mut result = build_band_matrix(&energies, centres, hop, sample_rate);
    result.unit = Some("dBFS".to_string());
    result.band_edges = Some(edges);
    result.model = Some("criticalBands".to_string());
    // Band power in dBFS: a level, not a normalized scale.
    result.normalized = Some(false);
    Ok(result)
}
