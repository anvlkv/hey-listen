//! Library matrix features: mel spectrogram, MFCC, chromagram, spectral contrast.

use super::super::support::{build_matrix, frame_grid, mono_buffer, oxi_err};
use super::super::{AnalysisError, MatrixResult, SharedParams, ToolOptions};

/// The twelve pitch-class names a chromagram's rows carry, in band order
/// (`PITCH_CLASSES[0] = "C"`). Width-12 equal temperament, sharps spelled with `#`.
const PITCH_CLASSES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// Attach the band-axis model metadata a chart labels the matrix with.
///
/// `normalized` is `Some(false)` for a level/energy matrix, `Some(true)` for a
/// normalized one, and `None` where neither label fits (MFCC: signed coefficients).
fn modelled(result: MatrixResult, model: &str, normalized: Option<bool>) -> MatrixResult {
    MatrixResult {
        model: Some(model.to_string()),
        normalized,
        ..result
    }
}

/// Log-mel spectrogram (frame × mel band).
pub fn mel_spectrogram(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MatrixResult, AnalysisError> {
    let (fft, hop) = frame_grid(mono.len(), params);
    let buf = mono_buffer(mono, sample_rate);
    let (band_lo, band_hi) = params.band(sample_rate);
    let f_min = options.mel_f_min().unwrap_or(band_lo as f32).max(0.0);
    let f_max = options
        .mel_f_max()
        .unwrap_or(band_hi as f32)
        .max(f_min + 1.0);
    let mel =
        oxiaudio::dsp::spectral::melspectrogram(&buf, options.n_mels(), f_min, f_max, fft, hop)
            .map_err(oxi_err)?;
    Ok(modelled(
        build_matrix(mel, hop, sample_rate),
        "mel",
        Some(false),
    ))
}

/// Mel-frequency cepstral coefficients (frame × coefficient).
pub fn mfcc(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MatrixResult, AnalysisError> {
    let (fft, hop) = frame_grid(mono.len(), params);
    let buf = mono_buffer(mono, sample_rate);
    let coeffs = oxiaudio::dsp::spectral::mfcc(&buf, options.n_mfcc(), options.n_mels(), fft, hop)
        .map_err(oxi_err)?;
    Ok(modelled(
        build_matrix(coeffs, hop, sample_rate),
        "mfcc",
        None,
    ))
}

/// Chromagram (frame × 12 pitch classes).
/// Chromagram (frame × 12 pitch classes).
///
/// The band axis is the twelve pitch classes in order, and the result carries their names
/// (`bandLabels`) so an agent reading `peakBand` knows **0 = C** without a second table.
pub fn chromagram(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<MatrixResult, AnalysisError> {
    let (fft, hop) = frame_grid(mono.len(), params);
    let buf = mono_buffer(mono, sample_rate);
    let frames = oxiaudio::dsp::spectral::chromagram(&buf, fft, hop)
        .into_iter()
        .map(|frame| frame.to_vec())
        .collect();
    let mut result = modelled(build_matrix(frames, hop, sample_rate), "chroma", Some(true));
    result.band_labels = Some(
        PITCH_CLASSES
            .iter()
            .map(|name| (*name).to_string())
            .collect(),
    );
    Ok(result)
}

/// Spectral contrast (frame × octave band, in dB).
pub fn spectral_contrast(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MatrixResult, AnalysisError> {
    let (fft, hop) = frame_grid(mono.len(), params);
    let buf = mono_buffer(mono, sample_rate);
    let frames = oxiaudio::dsp::spectral::spectral_contrast(&buf, fft, hop, options.n_bands())
        .map_err(oxi_err)?;
    Ok(modelled(
        build_matrix(frames, hop, sample_rate),
        "spectralContrast",
        Some(false),
    ))
}
