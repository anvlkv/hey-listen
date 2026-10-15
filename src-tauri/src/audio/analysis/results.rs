//! Result types returned by the analysis tools, plus the tagged
//! [`AnalysisResult`] union that crosses IPC (see `docs/data-model.md`).

use serde::Serialize;

/// Time-domain waveform over the window plus its level readouts.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WaveformResult {
    pub sample_rate: u32,
    pub frames: usize,
    pub duration: f64,
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
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
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
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpectrogramResult {
    pub sample_rate: u32,
    pub fft_size: usize,
    pub hop_size: usize,
    pub duration: f64,
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
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
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

/// One scalar value per analysis frame, plotted against time. `values` may contain
/// gaps (`None`) — e.g. unvoiced pitch frames or silent loudness blocks.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SeriesResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    /// Frame times in seconds.
    pub times: Vec<f32>,
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
}

/// A pitch track: the f0 series over time plus a voiced-frame summary, so a
/// near-empty track (almost no voiced frames) is self-evident without scanning
/// every `values` entry. Unvoiced frames are gaps (`null`).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PitchResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    /// Frame times in seconds.
    pub times: Vec<f32>,
    /// f0 in Hz per frame; unvoiced frames are gaps.
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    /// Frames with a detected pitch (non-gap `values`).
    pub voiced_frames: usize,
    /// `voiced_frames / frames` (0…1; 0 when there are no frames).
    pub voiced_fraction: f32,
}

/// A frame × band matrix (mel spectrogram, MFCC, chromagram, spectral contrast).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MatrixResult {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    pub bins: usize,
    pub duration: f32,
    /// Frame times in seconds.
    pub times: Vec<f32>,
    /// Band-axis positions (index or Hz) for the retained bands.
    pub bands: Vec<f32>,
    /// Frame-major `frames * bins` values.
    pub values: Vec<f32>,
    pub min_value: f32,
    pub max_value: f32,
}

/// Tempo / onset / downbeat analysis over one window: the onset-strength envelope
/// (one value per frame) plus the detected beat grid and event times. The rhythm
/// charts draw the envelope and mark the relevant events on it.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RhythmResult {
    pub bpm: f32,
    pub confidence: f32,
    pub hop_size: usize,
    /// Frame times (seconds) of `onset_strength`.
    pub times: Vec<f32>,
    /// Onset-strength envelope (half-wave-rectified spectral flux).
    pub onset_strength: Vec<f32>,
    /// Detected onset times (seconds).
    pub onset_times: Vec<f32>,
    /// Estimated beat times (seconds).
    pub beat_times: Vec<f32>,
    /// Estimated downbeat times (seconds).
    pub downbeat_times: Vec<f32>,
}

/// Integrated loudness (EBU R128).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LufsResult {
    pub lufs: f32,
}

/// Loudness range (LRA), in LU.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LraResult {
    pub lra: f32,
}

/// A tool's result, tagged by the tool id that produced it.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(tag = "tool", rename_all = "camelCase")]
#[ts(export)]
pub enum AnalysisResult {
    Waveform(WaveformResult),
    Spectrum(SpectrumResult),
    Spectrogram(SpectrogramResult),
    Levels(LevelsResult),
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
    Tempo(RhythmResult),
    Onsets(RhythmResult),
    Downbeats(RhythmResult),
    LoudnessIntegrated(LufsResult),
    LoudnessMomentary(SeriesResult),
    LoudnessRange(LraResult),
}
