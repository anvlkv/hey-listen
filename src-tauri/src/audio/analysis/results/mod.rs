//! Result types returned by the analysis tools, plus the tagged
//! [`AnalysisResult`] union that crosses IPC (see `docs/data-model.md`).
//!
//! Every time a result carries is in **source seconds** (see
//! [`AnalysisResult::rebase`]): the tools work on the sliced region alone, so their
//! times begin at 0, and `mod::run_window` — the one place that knows where the
//! window sits — re-bases them before the result leaves the engine. `window_start`
//! records that origin so a consumer can map a time back onto a frame.

use serde::{Deserialize, Serialize};

use crate::audio::analyzers::AnalyzerId;

mod calibrated_series;
mod loudness;
mod masking;
mod modulation;
mod notes;
mod rebase;
mod scalars;
mod series;
mod spatial;
mod stored;

pub use calibrated_series::*;
pub use loudness::*;
pub use masking::*;
pub use modulation::*;
pub use notes::*;
pub use scalars::*;
pub use series::*;
pub use spatial::*;
pub use stored::*;

/// Shift every entry of a result's time axis by `shift` (source seconds).
fn shift_times(times: &mut [f32], shift: f32) {
    for time in times.iter_mut() {
        *time += shift;
    }
}

/// Time-domain waveform over the window plus its level readouts.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WaveformResult {
    pub sample_rate: u32,
    pub frames: usize,
    pub duration: f64,
    /// Source seconds where the window starts (its times / frames are relative to this).
    pub window_start: f64,
    /// Peak amplitude (linear, 0…1+).
    pub peak: f32,
    pub rms: f32,
    pub peak_db: f32,
    pub rms_db: f32,
    /// Min/max envelope over the window (equal length, `MAX_ENVELOPE` buckets max).
    pub min: Vec<f32>,
    pub max: Vec<f32>,
}

/// Averaged magnitude spectrum over the window.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpectrumResult {
    pub sample_rate: u32,
    pub fft_size: usize,
    pub hop_size: usize,
    /// Number of STFT frames averaged.
    pub frames: usize,
    /// Bin centre frequencies (Hz) — band-limited.
    pub freqs: Vec<f32>,
    /// Mean magnitude per bin, in dBFS.
    pub mag_db: Vec<f32>,
    /// Minimum magnitude per bin across frames, in dBFS.
    pub min_db: Vec<f32>,
    /// Maximum magnitude per bin across frames, in dBFS.
    pub max_db: Vec<f32>,
    /// Frequency (Hz) and level (dBFS) of the strongest bin.
    pub peak_hz: f32,
    pub peak_db: f32,
}

/// STFT magnitude heatmap over the window.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpectrogramResult {
    pub sample_rate: u32,
    pub fft_size: usize,
    pub hop_size: usize,
    pub duration: f64,
    /// Source seconds where the window starts (frame 0 sits here).
    pub window_start: f64,
    /// Frame (time) and bin (frequency) counts of `mag_db`.
    pub frames: usize,
    pub bins: usize,
    /// Bin centre frequencies (Hz) for the retained bins — band-limited.
    pub freqs: Vec<f32>,
    /// Row-major `frames * bins` magnitudes in dBFS (frame-major).
    pub mag_db: Vec<f32>,
    pub min_db: f32,
    pub max_db: f32,
}

/// Time-domain level readouts (peak / RMS), without the waveform envelope.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LevelsResult {
    pub sample_rate: u32,
    pub frames: usize,
    pub duration: f64,
    pub peak: f32,
    pub rms: f32,
    pub peak_db: f32,
    pub rms_db: f32,
}

/// A pitch track: the f0 series over time plus a voiced-frame summary, so a
/// near-empty track (almost no voiced frames) is self-evident without scanning
/// every `values` entry. Unvoiced frames are gaps (`null`).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PitchResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    /// Frame times in **source seconds**.
    pub times: Vec<f32>,
    /// Source seconds where the window starts (`times[0]` is at or after this).
    pub window_start: f64,
    /// f0 in Hz per frame; unvoiced frames are gaps.
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    /// The f0 search window the detector actually used, in Hz, so a request a detector
    /// cannot honour shows here instead of being silently ignored.
    pub effective_min_f0_hz: f32,
    pub effective_max_f0_hz: f32,
    /// Frames with a detected pitch (non-gap `values`).
    pub voiced_frames: usize,
    /// `voiced_frames / frames` (0…1; 0 when there are no frames).
    pub voiced_fraction: f32,
    /// Whether enough voiced frames were found to call their median a pitch (M21.B).
    /// A summary omits `medianF0Hz` / `meanF0Hz` when this is false; the track itself
    /// is still returned so the caller can inspect it.
    pub f0_reliable: bool,
}

/// A frame × band matrix (mel spectrogram, MFCC, chromagram, spectral contrast,
/// critical bands, specific loudness).
///
/// The band axis is `bands` (an index or Hz); the trailing fields carry the exact
/// integration geometry, the value unit and the calibration state so a standalone
/// result and its summary can recover them (X3):
/// - `band_edges` — the exact band edges (Hz or Cam) when `bands` are centres of a
///   measurement axis; `None` for an index-based matrix (mel/mfcc/chroma/contrast).
/// - `unit` — the values' unit (`"dB"`, `"dBFS"`, `"sone/Cam"`, …).
/// - `calibrated` / `calibration_db_spl` — whether a dB SPL offset was applied.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatrixResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    pub bins: usize,
    pub duration: f32,
    /// Frame times in **source seconds**.
    pub times: Vec<f32>,
    /// Source seconds where the window starts (frame 0 sits here).
    pub window_start: f64,
    /// Band-axis positions (index or Hz) for the retained bands.
    pub bands: Vec<f32>,
    /// Frame-major `frames * bins` values.
    pub values: Vec<f32>,
    pub min_value: f32,
    pub max_value: f32,
    /// Exact band edges (Hz or Cam) for the retained bands; `None` when `bands` are
    /// indices rather than a measurement axis.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band_edges: Option<Vec<f32>>,
    /// The values' unit (e.g. `"dB"`, `"dBFS"`, `"sone/Cam"`); `None` for a unitless
    /// coefficient matrix.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    /// Whether a `calibrationDbSpl` offset was applied to the values.
    #[serde(default)]
    pub calibrated: bool,
    /// The dB SPL offset of a full-scale sine (`0` = uncalibrated).
    #[serde(default)]
    pub calibration_db_spl: f32,
}

/// Tempo / onset / downbeat analysis over one window: the onset-strength envelope
/// (one value per frame) plus the detected beat grid and event times. The rhythm
/// charts draw the envelope and mark the relevant events on it.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RhythmResult {
    pub bpm: f32,
    pub confidence: f32,
    pub hop_size: usize,
    /// Frame times of `onset_strength`, in **source seconds**.
    pub times: Vec<f32>,
    /// Source seconds where the window starts (frame 0 sits here).
    pub window_start: f64,
    /// Onset-strength envelope (half-wave-rectified spectral flux).
    pub onset_strength: Vec<f32>,
    /// Detected onset times (source seconds).
    pub onset_times: Vec<f32>,
    /// Estimated beat times (source seconds).
    pub beat_times: Vec<f32>,
    /// Estimated downbeat times (source seconds).
    pub downbeat_times: Vec<f32>,
}

/// A tool's result, tagged by the tool id that produced it.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "tool", rename_all = "camelCase")]
#[ts(export)]
pub enum AnalysisResult {
    Waveform(WaveformResult),
    Spectrum(SpectrumResult),
    Spectrogram(SpectrogramResult),
    Levels(LevelsResult),
    FrameRms(SeriesResult),
    MelSpectrogram(MatrixResult),
    Mfcc(MatrixResult),
    Chromagram(MatrixResult),
    SpectralContrast(MatrixResult),
    SpectralCentroid(SeriesResult),
    SpectralFlux(SeriesResult),
    SpectralRolloff(SeriesResult),
    SpectralFlatness(SeriesResult),
    SpectralBandwidth(SeriesResult),
    SpectralEntropy(SeriesResult),
    SpectralCrest(SeriesResult),
    HarmonicRatio(SeriesResult),
    ZeroCrossingRate(SeriesResult),
    PitchPyin(PitchResult),
    PitchYin(PitchResult),
    PitchAutocorr(PitchResult),
    NoteMetrics(NoteMetricsResult),
    Modulation(ModulationResult),
    Tempo(RhythmResult),
    Onsets(RhythmResult),
    Downbeats(RhythmResult),
    LoudnessIntegrated(LufsResult),
    LoudnessMomentary(SeriesResult),
    LoudnessRange(LraResult),
    CriticalBands(MatrixResult),
    Loudness(LoudnessResult),
    SpecificLoudness(MatrixResult),
    Sharpness(CalibratedSeriesResult),
    Roughness(CalibratedSeriesResult),
    FluctuationStrength(CalibratedSeriesResult),
    Masking(MaskingResult),
    Tonality(CalibratedSeriesResult),
    Spatial(SpatialResult),
}

impl AnalysisResult {
    /// The analyzer id that produced this result — the same id the catalog and the
    /// request use.
    pub fn tool_id(&self) -> AnalyzerId {
        match self {
            AnalysisResult::Waveform(_) => AnalyzerId::Waveform,
            AnalysisResult::Spectrum(_) => AnalyzerId::Spectrum,
            AnalysisResult::Spectrogram(_) => AnalyzerId::Spectrogram,
            AnalysisResult::Levels(_) => AnalyzerId::Levels,
            AnalysisResult::FrameRms(_) => AnalyzerId::FrameRms,
            AnalysisResult::MelSpectrogram(_) => AnalyzerId::MelSpectrogram,
            AnalysisResult::Mfcc(_) => AnalyzerId::Mfcc,
            AnalysisResult::Chromagram(_) => AnalyzerId::Chromagram,
            AnalysisResult::SpectralContrast(_) => AnalyzerId::SpectralContrast,
            AnalysisResult::SpectralCentroid(_) => AnalyzerId::SpectralCentroid,
            AnalysisResult::SpectralFlux(_) => AnalyzerId::SpectralFlux,
            AnalysisResult::SpectralRolloff(_) => AnalyzerId::SpectralRolloff,
            AnalysisResult::SpectralFlatness(_) => AnalyzerId::SpectralFlatness,
            AnalysisResult::SpectralBandwidth(_) => AnalyzerId::SpectralBandwidth,
            AnalysisResult::SpectralEntropy(_) => AnalyzerId::SpectralEntropy,
            AnalysisResult::SpectralCrest(_) => AnalyzerId::SpectralCrest,
            AnalysisResult::HarmonicRatio(_) => AnalyzerId::HarmonicRatio,
            AnalysisResult::ZeroCrossingRate(_) => AnalyzerId::ZeroCrossingRate,
            AnalysisResult::PitchPyin(_) => AnalyzerId::PitchPyin,
            AnalysisResult::PitchYin(_) => AnalyzerId::PitchYin,
            AnalysisResult::PitchAutocorr(_) => AnalyzerId::PitchAutocorr,
            AnalysisResult::NoteMetrics(_) => AnalyzerId::NoteMetrics,
            AnalysisResult::Modulation(_) => AnalyzerId::Modulation,
            AnalysisResult::Tempo(_) => AnalyzerId::Tempo,
            AnalysisResult::Onsets(_) => AnalyzerId::Onsets,
            AnalysisResult::Downbeats(_) => AnalyzerId::Downbeats,
            AnalysisResult::LoudnessIntegrated(_) => AnalyzerId::LoudnessIntegrated,
            AnalysisResult::LoudnessMomentary(_) => AnalyzerId::LoudnessMomentary,
            AnalysisResult::LoudnessRange(_) => AnalyzerId::LoudnessRange,
            AnalysisResult::CriticalBands(_) => AnalyzerId::CriticalBands,
            AnalysisResult::Loudness(_) => AnalyzerId::Loudness,
            AnalysisResult::SpecificLoudness(_) => AnalyzerId::SpecificLoudness,
            AnalysisResult::Sharpness(_) => AnalyzerId::Sharpness,
            AnalysisResult::Roughness(_) => AnalyzerId::Roughness,
            AnalysisResult::FluctuationStrength(_) => AnalyzerId::FluctuationStrength,
            AnalysisResult::Masking(_) => AnalyzerId::Masking,
            AnalysisResult::Tonality(_) => AnalyzerId::Tonality,
            AnalysisResult::Spatial(_) => AnalyzerId::Spatial,
        }
    }

    /// The scalar-per-frame series this result carries, when the tool returns one
    /// (every `SeriesResult` variant, including `frameRms` and momentary loudness).
    pub fn series(&self) -> Option<&SeriesResult> {
        match self {
            AnalysisResult::SpectralCentroid(r)
            | AnalysisResult::SpectralFlux(r)
            | AnalysisResult::SpectralRolloff(r)
            | AnalysisResult::SpectralFlatness(r)
            | AnalysisResult::SpectralBandwidth(r)
            | AnalysisResult::SpectralEntropy(r)
            | AnalysisResult::SpectralCrest(r)
            | AnalysisResult::HarmonicRatio(r)
            | AnalysisResult::ZeroCrossingRate(r)
            | AnalysisResult::LoudnessMomentary(r)
            | AnalysisResult::FrameRms(r) => Some(r),
            _ => None,
        }
    }

    /// The calibrated scalar-per-frame series this result carries, when the tool
    /// returns one (mirrors [`Self::series`] for the calibrated family).
    pub fn calibrated_series(&self) -> Option<&CalibratedSeriesResult> {
        match self {
            AnalysisResult::Sharpness(r)
            | AnalysisResult::Roughness(r)
            | AnalysisResult::FluctuationStrength(r)
            | AnalysisResult::Tonality(r) => Some(r),
            _ => None,
        }
    }
}
