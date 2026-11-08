//! The `criticalBands` analyzer (M26): STFT magnitude integrated into Bark or
//! ERB critical bands, returned as a frame × band energy matrix.

use super::super::psychoacoustics::bands::{band_energies, critical_band_edges};
use super::super::{AnalysisError, MatrixResult, SharedParams, ToolOptions};
use super::shared::{build_band_matrix, stft_with_freqs};

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
    let (hop, magnitudes, freqs) = stft_with_freqs(mono, sample_rate, params)?;

    let (min_hz, max_hz) = params.band(sample_rate);
    let edges = critical_band_edges(options.scale(), min_hz as f32, max_hz as f32);
    let centres: Vec<f32> = edges
        .windows(2)
        .map(|pair| (pair[0] + pair[1]) / 2.0)
        .collect();

    let energies = band_energies(&magnitudes, &freqs, &edges);
    Ok(build_band_matrix(&energies, centres, hop, sample_rate))
}
