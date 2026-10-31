//! The delta per result family (M25; relative matching in M25.B).
//!
//! Every family gets a delta, so MCP and the CLI can compare any tool. Since M25.B the
//! frames and events are matched on a **relative** axis: each side starts at 0 at its
//! own window start, and the reference is shifted by the fine-tune offset. The delta
//! therefore carries relative `times`, not source seconds. See `docs/comparison.md` →
//! "The delta".

use serde::Serialize;

use crate::audio::analysis::AnalysisResult;

use super::align::{Side, Span};
use super::events;
use super::stats::{DeltaHeader, DeltaStats};

mod families;

pub use families::series_delta;
use families::{
    matrix_delta, modulation_delta, scalar_delta, spectrogram_delta, spectrum_delta, waveform_delta,
};

/// The per-family delta of two results.
///
/// The variants differ a lot in size (an events delta carries three pairing
/// structures); a comparison is built once and serialized, never stored in bulk, so
/// boxing would only add noise.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ComparisonDiff {
    Series(SeriesDelta),
    Spectrum(SpectrumDelta),
    Matrix(MatrixDelta),
    Events(events::EventsDelta),
    Notes(events::NotesDelta),
    Modulation(ModulationDelta),
    Waveform(WaveformDelta),
    Scalar(ScalarDelta),
}

/// A series delta over the matched frames in the common span.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub stats: DeltaStats,
    /// Matched frame times on the relative axis (A's frame times).
    pub times: Vec<f32>,
    /// `B − A` per matched frame (`null` where either side is a gap).
    pub values: Vec<Option<f32>>,
    pub a: Vec<Option<f32>>,
    pub b: Vec<Option<f32>>,
}

/// A spectrum delta, one value per shared bin.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub stats: DeltaStats,
    /// Bin centre frequencies (Hz), shared by both sides.
    pub freqs: Vec<f32>,
    /// `B − A` per bin, in dB.
    pub values: Vec<f32>,
}

/// A frame × band delta over the matched frames in the common span.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub stats: DeltaStats,
    /// Frame times on the relative axis (A's frame times).
    pub times: Vec<f32>,
    /// One flag per column: `false` means A has a frame there but B has no counterpart
    /// within tolerance, so the column is a **null** column (M25.B).
    pub columns: Vec<bool>,
    pub bins: usize,
    /// Frame-major `frames × bins` delta (`0` in a null column; ignored by the stats).
    pub values: Vec<f32>,
}

/// A modulation-spectrum delta, aligned by modulation-rate bin.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModulationDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    /// The shared modulation-rate axis (Hz).
    pub rate_hz: Vec<f32>,
    pub am: LineDelta,
    pub fm: LineDelta,
}

/// One modulation line's per-bin delta.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineDelta {
    pub stats: DeltaStats,
    /// `B − A` per rate bin; empty when one side has no spectrum.
    pub values: Vec<f32>,
}

/// A waveform envelope delta over the common span (M25.B).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    /// Buckets compared (A's bucket times sampled against B's envelope).
    pub buckets: usize,
    /// The sampled bucket times on the relative axis.
    pub times: Vec<f32>,
    /// `B − A` per sampled bucket of the upper envelope.
    pub values: Vec<f32>,
}

/// A scalar readout's field-by-field delta.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScalarDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub fields: Vec<FieldDelta>,
}

/// One numeric field of a scalar result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDelta {
    pub key: String,
    pub a: f64,
    pub b: f64,
    pub delta: f64,
}

/// Compute the delta for two results that the comparability check accepted.
///
/// `b_offset` is the fine-tune offset δ and `common` the span (in owner coordinates)
/// the delta covers.
pub fn diff(a: &Side<'_>, b: &Side<'_>, b_offset: f64, common: Option<Span>) -> ComparisonDiff {
    let (origin_a, origin_b) = (result_origin(a.result), result_origin(b.result));
    match (a.result, b.result) {
        (AnalysisResult::Spectrum(a_r), AnalysisResult::Spectrum(b_r)) => {
            ComparisonDiff::Spectrum(spectrum_delta(a_r, b_r))
        }
        (AnalysisResult::Spectrogram(a_r), AnalysisResult::Spectrogram(b_r)) => {
            let times_a = relative(&spectrogram_frames(a_r), origin_a, 0.0);
            let times_b = relative(&spectrogram_frames(b_r), origin_b, b_offset);
            ComparisonDiff::Matrix(spectrogram_delta(a_r, &times_a, b_r, &times_b, common))
        }
        (AnalysisResult::MelSpectrogram(a_r), AnalysisResult::MelSpectrogram(b_r))
        | (AnalysisResult::Mfcc(a_r), AnalysisResult::Mfcc(b_r))
        | (AnalysisResult::Chromagram(a_r), AnalysisResult::Chromagram(b_r))
        | (AnalysisResult::SpectralContrast(a_r), AnalysisResult::SpectralContrast(b_r)) => {
            let times_a = relative(&a_r.times, origin_a, 0.0);
            let times_b = relative(&b_r.times, origin_b, b_offset);
            ComparisonDiff::Matrix(matrix_delta(a_r, &times_a, b_r, &times_b, common))
        }
        (AnalysisResult::NoteMetrics(a_r), AnalysisResult::NoteMetrics(b_r)) => {
            ComparisonDiff::Notes(events::notes_delta(
                a_r, b_r, origin_a, origin_b, b_offset, common,
            ))
        }
        (AnalysisResult::Tempo(a_r), AnalysisResult::Tempo(b_r))
        | (AnalysisResult::Onsets(a_r), AnalysisResult::Onsets(b_r))
        | (AnalysisResult::Downbeats(a_r), AnalysisResult::Downbeats(b_r)) => {
            ComparisonDiff::Events(events::events_delta(
                a_r,
                b_r,
                origin_a,
                origin_b,
                b_offset,
                common,
                hop_secs(a.result, a.rate).max(hop_secs(b.result, b.rate)),
            ))
        }
        (AnalysisResult::Modulation(a_r), AnalysisResult::Modulation(b_r)) => {
            ComparisonDiff::Modulation(modulation_delta(a_r, b_r))
        }
        (AnalysisResult::Waveform(a_r), AnalysisResult::Waveform(b_r)) => {
            let times_a = relative(&waveform_times(a_r), origin_a, 0.0);
            let times_b = relative(&waveform_times(b_r), origin_b, b_offset);
            ComparisonDiff::Waveform(waveform_delta(a_r, &times_a, b_r, &times_b, common))
        }
        _ => match (a.result.series(), b.result.series()) {
            (Some(a_r), Some(b_r)) => {
                let times_a = relative(&a_r.times, origin_a, 0.0);
                let times_b = relative(&b_r.times, origin_b, b_offset);
                ComparisonDiff::Series(series_delta(a_r, &times_a, b_r, &times_b, common))
            }
            _ => ComparisonDiff::Scalar(scalar_delta(a.result, b.result)),
        },
    }
}

// --- relative coordinates ---------------------------------------------------

/// The source second a time-based result's frame 0 refers to.
pub fn result_origin(result: &AnalysisResult) -> f64 {
    match result {
        AnalysisResult::Waveform(r) => r.window_start,
        AnalysisResult::Spectrogram(r) => r.window_start,
        AnalysisResult::MelSpectrogram(r)
        | AnalysisResult::Mfcc(r)
        | AnalysisResult::Chromagram(r)
        | AnalysisResult::SpectralContrast(r) => r.window_start,
        AnalysisResult::PitchPyin(r)
        | AnalysisResult::PitchYin(r)
        | AnalysisResult::PitchAutocorr(r) => r.window_start,
        AnalysisResult::NoteMetrics(r) => r.window_start,
        AnalysisResult::Modulation(r) => r.window_start,
        AnalysisResult::Tempo(r) | AnalysisResult::Onsets(r) | AnalysisResult::Downbeats(r) => {
            r.window_start
        }
        other => other.series().map(|r| r.window_start).unwrap_or(0.0),
    }
}

/// Move absolute frame times onto the relative axis (`t − origin + shift`).
pub fn relative(times: &[f32], origin: f64, shift: f64) -> Vec<f32> {
    times
        .iter()
        .map(|time| (f64::from(*time) - origin + shift) as f32)
        .collect()
}

/// A spectrogram's frame times are implicit (`window_start + frame · hop / rate`).
fn spectrogram_frames(r: &crate::audio::analysis::SpectrogramResult) -> Vec<f32> {
    let hop = r.hop_size as f64 / f64::from(r.sample_rate.max(1));
    (0..r.frames)
        .map(|frame| (r.window_start + frame as f64 * hop) as f32)
        .collect()
}

/// A waveform result's bucket start times (one bucket per envelope point).
fn waveform_times(r: &crate::audio::analysis::WaveformResult) -> Vec<f32> {
    let buckets = r.max.len();
    if buckets == 0 {
        return Vec::new();
    }
    let step = r.duration.max(0.0) / buckets as f64;
    (0..buckets)
        .map(|index| (r.window_start + index as f64 * step) as f32)
        .collect()
}

// --- shared helpers ---------------------------------------------------------

/// Whether an instant lies in the span (all instants when there is none).
fn in_span(time: f32, span: Option<Span>) -> bool {
    span.is_none_or(|span| span.contains(time))
}

/// The index in `times` nearest to `time`, advancing `cursor` monotonically.
fn nearest(times: &[f32], time: f32, cursor: &mut usize) -> Option<usize> {
    if times.is_empty() {
        return None;
    }
    *cursor = (*cursor).min(times.len() - 1);
    while *cursor + 1 < times.len()
        && (times[*cursor + 1] - time).abs() <= (times[*cursor] - time).abs()
    {
        *cursor += 1;
    }
    Some(*cursor)
}

/// The typical spacing of a uniform time axis (median consecutive difference).
pub fn hop_of(times: &[f32]) -> f32 {
    if times.len() < 2 {
        return 0.0;
    }
    let mut steps: Vec<f32> = times.windows(2).map(|pair| pair[1] - pair[0]).collect();
    steps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    steps[steps.len() / 2].max(0.0)
}

/// The effective hop in seconds for a result, when it exposes one.
pub fn hop_secs(result: &AnalysisResult, rate: u32) -> f32 {
    let hop = match result {
        AnalysisResult::Spectrogram(r) => Some(r.hop_size),
        AnalysisResult::Spectrum(r) => Some(r.hop_size),
        AnalysisResult::PitchPyin(r)
        | AnalysisResult::PitchYin(r)
        | AnalysisResult::PitchAutocorr(r) => Some(r.hop_size),
        AnalysisResult::MelSpectrogram(r)
        | AnalysisResult::Mfcc(r)
        | AnalysisResult::Chromagram(r)
        | AnalysisResult::SpectralContrast(r) => Some(r.hop_size),
        AnalysisResult::Tempo(r) | AnalysisResult::Onsets(r) | AnalysisResult::Downbeats(r) => {
            Some(r.hop_size)
        }
        other => other.series().map(|r| r.hop_size),
    };
    hop.map(|hop| hop as f32 / rate.max(1) as f32)
        .unwrap_or(0.0)
}

/// Format an optional delta for a summary line.
fn fmt_opt(value: Option<f32>) -> String {
    value
        .map(|value| format!("{value:+.2}"))
        .unwrap_or_else(|| "—".to_string())
}
