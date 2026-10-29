//! The delta per result family (M25).
//!
//! Every family gets a delta in M25, so MCP and the CLI can compare any tool; the
//! **views** for matrix/event/notes/modulation/waveform land in M25.A. See
//! `docs/comparison.md` → "The delta".

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

/// A series delta over the matched frames in the overlap.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub stats: DeltaStats,
    /// Matched frame times (A's frame times).
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

/// A frame × band delta over the matched frames in the overlap.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub stats: DeltaStats,
    /// Matched frame times (A's frame times).
    pub times: Vec<f32>,
    pub bins: usize,
    /// Frame-major `frames × bins` delta.
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

/// A waveform envelope delta — only when both windows are identical.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    /// Envelope buckets compared (0 when the windows differ).
    pub buckets: usize,
    /// `B − A` per bucket of the upper envelope.
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
pub fn diff(a: &Side<'_>, b: &Side<'_>, overlap: Option<Span>) -> ComparisonDiff {
    match (a.result, b.result) {
        (AnalysisResult::Spectrum(a_r), AnalysisResult::Spectrum(b_r)) => {
            ComparisonDiff::Spectrum(spectrum_delta(a_r, b_r))
        }
        (AnalysisResult::Spectrogram(a_r), AnalysisResult::Spectrogram(b_r)) => {
            ComparisonDiff::Matrix(spectrogram_delta(a_r, b_r, overlap))
        }
        (AnalysisResult::MelSpectrogram(a_r), AnalysisResult::MelSpectrogram(b_r))
        | (AnalysisResult::Mfcc(a_r), AnalysisResult::Mfcc(b_r))
        | (AnalysisResult::Chromagram(a_r), AnalysisResult::Chromagram(b_r))
        | (AnalysisResult::SpectralContrast(a_r), AnalysisResult::SpectralContrast(b_r)) => {
            ComparisonDiff::Matrix(matrix_delta(a_r, b_r, overlap))
        }
        (AnalysisResult::NoteMetrics(a_r), AnalysisResult::NoteMetrics(b_r)) => {
            ComparisonDiff::Notes(events::notes_delta(a_r, b_r, overlap))
        }
        (AnalysisResult::Tempo(a_r), AnalysisResult::Tempo(b_r))
        | (AnalysisResult::Onsets(a_r), AnalysisResult::Onsets(b_r))
        | (AnalysisResult::Downbeats(a_r), AnalysisResult::Downbeats(b_r)) => {
            ComparisonDiff::Events(events::events_delta(
                a_r,
                b_r,
                overlap,
                hop_secs(a.result, a.rate).max(hop_secs(b.result, b.rate)),
            ))
        }
        (AnalysisResult::Modulation(a_r), AnalysisResult::Modulation(b_r)) => {
            ComparisonDiff::Modulation(modulation_delta(a_r, b_r))
        }
        (AnalysisResult::Waveform(a_r), AnalysisResult::Waveform(b_r)) => {
            ComparisonDiff::Waveform(waveform_delta(a_r, b_r, a.setup.span(), b.setup.span()))
        }
        _ => match (a.result.series(), b.result.series()) {
            (Some(a_r), Some(b_r)) => ComparisonDiff::Series(series_delta(a_r, b_r, overlap)),
            _ => ComparisonDiff::Scalar(scalar_delta(a.result, b.result)),
        },
    }
}

// --- shared helpers ---------------------------------------------------------

/// Whether an instant lies in the overlap (all instants when there is no overlap).
fn in_overlap(time: f32, overlap: Option<Span>) -> bool {
    overlap.is_none_or(|span| span.contains(time))
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
