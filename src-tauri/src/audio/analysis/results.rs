//! Result types returned by the analysis tools, plus the tagged
//! [`AnalysisResult`] union that crosses IPC (see `docs/data-model.md`).
//!
//! Every time a result carries is in **source seconds** (see
//! [`AnalysisResult::rebase`]): the tools work on the sliced region alone, so their
//! times begin at 0, and `mod::run_window` — the one place that knows where the
//! window sits — re-bases them before the result leaves the engine. `window_start`
//! records that origin so a consumer can map a time back onto a frame.

use serde::Serialize;

/// Shift every entry of a result's time axis by `shift` (source seconds).
fn shift_times(times: &mut [f32], shift: f32) {
    for time in times.iter_mut() {
        *time += shift;
    }
}

/// Time-domain waveform over the window plus its level readouts.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
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
    /// Frame times in **source seconds**.
    pub times: Vec<f32>,
    /// Source seconds where the window starts (`times[0]` is at or after this).
    pub window_start: f64,
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    /// The RMS frame length in samples, for tools that measure per frame (`frameRms`).
    /// Absent for tools whose frames are defined by the shared FFT size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub frame_size: Option<usize>,
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
    /// Frame times in **source seconds**.
    pub times: Vec<f32>,
    /// Source seconds where the window starts (`times[0]` is at or after this).
    pub window_start: f64,
    /// f0 in Hz per frame; unvoiced frames are gaps.
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    /// The f0 search window the detector actually used, in Hz. pYIN's fixed
    /// 50–2000 Hz window shows here instead of a requested range it cannot honour.
    pub effective_min_f0_hz: f32,
    pub effective_max_f0_hz: f32,
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

/// One detected audio **note** (a segment above the gate) with its level summary.
///
/// A note here is an acoustic event found by `noteMetrics` — distinct from a project
/// **annotation** (the M14 `Note` payload, user-authored commentary).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NoteMetric {
    pub start_secs: f32,
    pub end_secs: f32,
    pub duration_secs: f32,
    /// Silence between the previous note and this one (leading silence for the first).
    pub gap_before_secs: f32,
    /// Silence between this note and the next one (trailing silence for the last).
    pub gap_after_secs: f32,
    pub rms_db: f32,
    pub peak_db: f32,
    /// `rms_db` relative to the reference (loudest) note — 0 for the reference.
    pub rms_db_rel_loudest: f32,
    /// `peak_db` relative to the reference (loudest) note.
    pub peak_db_rel_loudest: f32,
    /// Frame-RMS envelope at `NoteMetricsResult::envelope_positions` (dBFS).
    pub envelope_db: Vec<f32>,
}

/// A silence **gap** between two detected notes. Leading/trailing silence is not
/// listed here (it is reflected in the first / last note's gap fields).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GapMetric {
    pub start_secs: f32,
    pub end_secs: f32,
    pub duration_secs: f32,
}

/// Note segmentation over the window: the detected notes, the gaps between them, and
/// the summary an agent needs without reading every record (M18).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NoteMetricsResult {
    /// Source seconds where the window starts (all `*_secs` values are source seconds).
    pub window_start: f64,
    pub note_count: usize,
    pub gap_count: usize,
    /// Sum of the gaps **between** notes (leading/trailing silence excluded).
    pub total_gap_secs: f32,
    pub longest_gap_secs: f32,
    pub median_note_secs: f32,
    pub median_gap_secs: f32,
    /// The gate actually used: `max(gateFloorDb, windowPeakDb − gateDb)`.
    pub threshold_db: f32,
    /// Normalized positions (0…1) of each note's `envelope_db` samples.
    pub envelope_positions: Vec<f32>,
    /// Index of the loudest note (the level reference), if any.
    pub reference_note_index: Option<usize>,
    pub notes: Vec<NoteMetric>,
    pub gaps: Vec<GapMetric>,
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
    Tempo(RhythmResult),
    Onsets(RhythmResult),
    Downbeats(RhythmResult),
    LoudnessIntegrated(LufsResult),
    LoudnessMomentary(SeriesResult),
    LoudnessRange(LraResult),
}

impl AnalysisResult {
    /// Re-base a result produced over the sliced region `[start, start + span)` onto
    /// **source seconds**: shift every time it carries by `start` and record the
    /// origin.
    ///
    /// The tools only ever see the slice, so their times begin at 0; this is the one
    /// place that knows where the window sits, and it runs before a result leaves the
    /// engine — so the GUI, the MCP server, the batch CLI and an export all speak the
    /// same absolute times as an `AnalysisWindow` / a [`super::super::super::project::Note`].
    /// Tools with no time axis (`spectrum`, the scalar readouts) are left alone.
    pub fn rebase(&mut self, start: f64) {
        let shift = start as f32;
        match self {
            AnalysisResult::Waveform(result) => result.window_start = start,
            AnalysisResult::Spectrogram(result) => result.window_start = start,
            AnalysisResult::MelSpectrogram(result)
            | AnalysisResult::Mfcc(result)
            | AnalysisResult::Chromagram(result)
            | AnalysisResult::SpectralContrast(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
            }
            AnalysisResult::SpectralCentroid(result)
            | AnalysisResult::SpectralFlux(result)
            | AnalysisResult::SpectralRolloff(result)
            | AnalysisResult::SpectralFlatness(result)
            | AnalysisResult::SpectralBandwidth(result)
            | AnalysisResult::SpectralEntropy(result)
            | AnalysisResult::SpectralCrest(result)
            | AnalysisResult::HarmonicRatio(result)
            | AnalysisResult::ZeroCrossingRate(result)
            | AnalysisResult::LoudnessMomentary(result)
            | AnalysisResult::FrameRms(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
            }
            AnalysisResult::PitchPyin(result)
            | AnalysisResult::PitchYin(result)
            | AnalysisResult::PitchAutocorr(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
            }
            AnalysisResult::NoteMetrics(result) => {
                result.window_start = start;
                for note in &mut result.notes {
                    note.start_secs += shift;
                    note.end_secs += shift;
                }
                for gap in &mut result.gaps {
                    gap.start_secs += shift;
                    gap.end_secs += shift;
                }
            }
            AnalysisResult::Tempo(result)
            | AnalysisResult::Onsets(result)
            | AnalysisResult::Downbeats(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
                shift_times(&mut result.onset_times, shift);
                shift_times(&mut result.beat_times, shift);
                shift_times(&mut result.downbeat_times, shift);
            }
            AnalysisResult::Spectrum(_)
            | AnalysisResult::Levels(_)
            | AnalysisResult::LoudnessIntegrated(_)
            | AnalysisResult::LoudnessRange(_) => {}
        }
    }
}
