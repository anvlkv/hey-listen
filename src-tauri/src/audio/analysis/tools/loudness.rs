//! The `loudness` and `specificLoudness` analyzers (M27): the stationary
//! Moore–Glasberg model run per STFT frame.

use super::super::psychoacoustics::bands::critical_band_edges;
use super::super::psychoacoustics::loudness::{analyze_frame, band_mean, FrameLoudness};
use super::super::psychoacoustics::scales::{cam, Scale};
use super::super::support::frame_times;
use super::super::{AnalysisError, LoudnessResult, MatrixResult, SharedParams, ToolOptions};
use super::shared::{build_band_matrix, stft_with_freqs_amplitude};

/// The model this tool implements, named the way the docs and chart copy name it.
const LOUDNESS_MODEL: &str = "Moore–Glasberg / ISO 532-2 family approximation";
/// The standard the model approximates.
const LOUDNESS_STANDARD: &str = "ISO 532-2";

/// dB SPL per bin (component level + calibration).
///
/// The shared STFT's magnitudes are coherent-gain-normalized **component amplitudes**
/// (a bin-centred full-scale sine reads 0 dBFS), so `20·log10(magnitude)` is the
/// component's level and the calibration offset converts it to dB SPL. A zero bin is
/// non-finite so the model drops it: the analysis dB floor is not audible sound, and
/// treating it as such would inject a broadband offset once a calibration is supplied.
fn frame_levels(magnitudes: &[f32], calibration_db_spl: f32) -> Vec<f32> {
    magnitudes
        .iter()
        .map(|&magnitude| {
            let magnitude = f64::from(magnitude);
            if magnitude > 0.0 {
                (20.0 * magnitude.log10() + f64::from(calibration_db_spl)) as f32
            } else {
                f32::NEG_INFINITY
            }
        })
        .collect()
}

/// Run the model over the shared STFT: the effective hop and one [`FrameLoudness`]
/// per frame.
///
/// Bins outside the shared `freqMinHz`/`freqMaxHz` band are dropped **before** the
/// excitation is computed, so an excluded input component cannot excite a retained
/// output band. This is the same range [`specific_loudness`] crops its ERB bands to.
fn run_frames(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    calibration_db_spl: f32,
) -> Result<(usize, Vec<FrameLoudness>), AnalysisError> {
    let (hop, magnitudes, freqs) = stft_with_freqs_amplitude(mono, sample_rate, params)?;
    let (min_hz, max_hz) = params.band(sample_rate);
    let frames = magnitudes
        .iter()
        .map(|frame| {
            let mut levels = frame_levels(frame, calibration_db_spl);
            for (level, &hz) in levels.iter_mut().zip(&freqs) {
                let hz = f64::from(hz);
                if hz < min_hz || hz > max_hz {
                    *level = f32::NEG_INFINITY;
                }
            }
            analyze_frame(&freqs, &levels)
        })
        .collect();
    Ok((hop, frames))
}

/// Loudness `N` (sones) and loudness level `LN` (phons) per STFT frame.
pub(super) fn loudness(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<LoudnessResult, AnalysisError> {
    let calibration = options.calibration_db_spl();
    let (hop, frames) = run_frames(mono, sample_rate, params, calibration)?;
    let loudness_sone = frames
        .iter()
        .map(|frame| frame.sone.is_finite().then_some(frame.sone))
        .collect();
    let loudness_phon = frames
        .iter()
        .map(|frame| frame.phon.is_finite().then_some(frame.phon))
        .collect();
    Ok(LoudnessResult {
        sample_rate,
        hop_size: hop,
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        times: frame_times(frames.len(), hop, sample_rate),
        loudness_sone,
        loudness_phon,
        calibrated: calibration > 0.0,
        calibration_db_spl: calibration,
        model: Some(LOUDNESS_MODEL.to_string()),
        standard: Some(LOUDNESS_STANDARD.to_string()),
    })
}

/// The specific-loudness map `N'(z)` per frame on the requested ERB bands.
///
/// `bands` holds the band-centre frequencies (Hz) and `values` the band-mean specific
/// loudness in **sone per Cam**, frame-major: the density integrates over the ERB
/// (Cam) axis, not Bark. Each band's mean is measured over its full span, so summing
/// `value × band span in Cam` reproduces the total loudness.
pub(super) fn specific_loudness(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<MatrixResult, AnalysisError> {
    let calibration = options.calibration_db_spl();
    let (hop, frames) = run_frames(mono, sample_rate, params, calibration)?;

    let (min_hz, max_hz) = params.band(sample_rate);
    let edges = critical_band_edges(Scale::Erb, min_hz as f32, max_hz as f32);
    let centres: Vec<f32> = edges
        .windows(2)
        .map(|pair| (pair[0] + pair[1]) / 2.0)
        .collect();
    let edges_cam: Vec<f32> = edges.iter().map(|&hz| cam(hz)).collect();

    let grid: Vec<Vec<f32>> = frames
        .iter()
        .map(|frame| {
            edges_cam
                .windows(2)
                .map(|pair| band_mean(&frame.specific, pair[0], pair[1]))
                .collect()
        })
        .collect();
    let mut result = build_band_matrix(&grid, centres, hop, sample_rate);
    result.unit = Some("sone/Cam".to_string());
    result.band_edges = Some(edges);
    result.calibrated = calibration > 0.0;
    result.calibration_db_spl = calibration;
    result.model = Some("specificLoudness".to_string());
    // A physical loudness density (sone per Cam), not a comparison-only scale.
    result.normalized = Some(false);
    Ok(result)
}
