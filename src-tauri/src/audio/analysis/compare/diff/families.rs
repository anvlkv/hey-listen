//! The per-family delta implementations (M25; relative matching in M25.B), split from
//! [`super`] to keep each file inside the source-size budget. Every family is covered,
//! so MCP and the CLI can compare any tool. Frame times arrive already on the relative
//! axis; see [`super`] for the coordinate transform and `docs/comparison.md` → "The
//! delta".

use crate::audio::analysis::{
    AnalysisResult, LevelsResult, LraResult, LufsResult, MatrixResult, SeriesResult,
    SpectrogramResult, SpectrumResult, WaveformResult,
};

use super::super::align::Span;
use super::super::stats::{DeltaHeader, DeltaStats};
use super::{fmt_opt, ScalarDelta, SeriesDelta, SpectrumDelta, WaveformDelta};
use super::{hop_of, in_span, nearest, FieldDelta, LineDelta, MatrixDelta, ModulationDelta};

// --- series -----------------------------------------------------------------

/// A series delta over the frames present in the common span (all frames when `None`).
///
/// `a_times` / `b_times` are the sides' frame times on the relative axis.
pub fn series_delta(
    a: &SeriesResult,
    a_times: &[f32],
    b: &SeriesResult,
    b_times: &[f32],
    span: Option<Span>,
) -> SeriesDelta {
    let tol = hop_of(a_times).max(hop_of(b_times)).max(1e-4) * 0.6;
    let mut times = Vec::new();
    let mut values = Vec::new();
    let mut a_values = Vec::new();
    let mut b_values = Vec::new();
    let mut pairs = Vec::new();
    let mut cursor = 0usize;
    for (index, &time) in a_times.iter().enumerate() {
        if !in_span(time, span) {
            continue;
        }
        let Some(value_a) = a.values.get(index).copied().flatten() else {
            continue;
        };
        let Some(b_index) = nearest(b_times, time, &mut cursor) else {
            continue;
        };
        if (b_times[b_index] - time).abs() > tol {
            continue;
        }
        let value_b = b.values.get(b_index).copied().flatten();
        times.push(time);
        a_values.push(Some(value_a));
        b_values.push(value_b);
        if let Some(value_b) = value_b {
            values.push(Some(value_b - value_a));
            pairs.push((value_a, value_b));
        } else {
            values.push(None);
        }
    }
    let stats = DeltaStats::of(&pairs);
    let header = DeltaHeader::new(stats.describe(), &stats);
    SeriesDelta {
        header,
        stats,
        times,
        values,
        a: a_values,
        b: b_values,
    }
}

// --- spectrum ---------------------------------------------------------------

pub(super) fn spectrum_delta(a: &SpectrumResult, b: &SpectrumResult) -> SpectrumDelta {
    let bins = a
        .freqs
        .len()
        .min(a.mag_db.len())
        .min(b.freqs.len())
        .min(b.mag_db.len());
    let pairs: Vec<(f32, f32)> = (0..bins).map(|i| (a.mag_db[i], b.mag_db[i])).collect();
    let values: Vec<f32> = pairs.iter().map(|(a, b)| b - a).collect();
    let stats = DeltaStats::of(&pairs);
    let summary = format!("{} · {bins} bins", stats.describe());
    SpectrumDelta {
        header: DeltaHeader::new(summary, &stats),
        stats,
        freqs: a.freqs[..bins].to_vec(),
        values,
    }
}

// --- matrices ---------------------------------------------------------------

pub(super) fn matrix_delta(
    a: &MatrixResult,
    a_times: &[f32],
    b: &MatrixResult,
    b_times: &[f32],
    span: Option<Span>,
) -> MatrixDelta {
    let read_a =
        |frame: usize, band: usize| a.values.get(frame * a.bins + band).copied().unwrap_or(0.0);
    let read_b =
        |frame: usize, band: usize| b.values.get(frame * b.bins + band).copied().unwrap_or(0.0);
    grid_delta(a_times, a.bins, &read_a, b_times, b.bins, &read_b, span)
}

pub(super) fn spectrogram_delta(
    a: &SpectrogramResult,
    a_times: &[f32],
    b: &SpectrogramResult,
    b_times: &[f32],
    span: Option<Span>,
) -> MatrixDelta {
    let read_a =
        |frame: usize, band: usize| a.mag_db.get(frame * a.bins + band).copied().unwrap_or(0.0);
    let read_b =
        |frame: usize, band: usize| b.mag_db.get(frame * b.bins + band).copied().unwrap_or(0.0);
    grid_delta(a_times, a.bins, &read_a, b_times, b.bins, &read_b, span)
}

/// The shared frame × band delta: A's frames inside the common span are the columns,
/// and a frame with no B counterpart within tolerance is a **null column** (M25.B) —
/// dropping it would collapse the time axis.
#[allow(clippy::too_many_arguments)]
fn grid_delta(
    a_times: &[f32],
    a_bins: usize,
    read_a: &dyn Fn(usize, usize) -> f32,
    b_times: &[f32],
    b_bins: usize,
    read_b: &dyn Fn(usize, usize) -> f32,
    span: Option<Span>,
) -> MatrixDelta {
    let bins = a_bins.min(b_bins);
    let tol = hop_of(a_times).max(hop_of(b_times)).max(1e-4) * 0.6;
    let mut times = Vec::new();
    let mut columns = Vec::new();
    let mut values = Vec::new();
    let mut pairs = Vec::new();
    let mut cursor = 0usize;
    for (frame, &time) in a_times.iter().enumerate() {
        if !in_span(time, span) {
            continue;
        }
        let counterpart = nearest(b_times, time, &mut cursor)
            .filter(|index| (b_times[*index] - time).abs() <= tol);
        times.push(time);
        columns.push(counterpart.is_some());
        for band in 0..bins {
            let value_a = read_a(frame, band);
            match counterpart {
                Some(b_frame) => {
                    let value_b = read_b(b_frame, band);
                    values.push(value_b - value_a);
                    pairs.push((value_a, value_b));
                }
                // A null column still occupies its frame; the Δ view paints it empty.
                None => values.push(0.0),
            }
        }
    }
    let stats = DeltaStats::of(&pairs);
    let matched = columns.iter().filter(|matched| **matched).count();
    let summary = format!("{} · {matched}×{bins}", stats.describe());
    MatrixDelta {
        header: DeltaHeader::new(summary, &stats),
        stats,
        times,
        columns,
        bins,
        values,
    }
}

// --- modulation -------------------------------------------------------------

pub(super) fn modulation_delta(
    a: &crate::audio::analysis::ModulationResult,
    b: &crate::audio::analysis::ModulationResult,
) -> ModulationDelta {
    let aligned = a.mod_freqs.len() == b.mod_freqs.len()
        && a.mod_freqs
            .iter()
            .zip(&b.mod_freqs)
            .all(|(x, y)| (x - y).abs() < 1e-3);
    if !aligned {
        return ModulationDelta {
            header: DeltaHeader::text("differing modulation-rate grids — no delta"),
            rate_hz: a.mod_freqs.clone(),
            am: LineDelta::default(),
            fm: LineDelta::default(),
        };
    }
    let am = line_delta(&a.am_db, &b.am_db);
    let fm = line_delta(&a.fm_db, &b.fm_db);
    let summary = format!(
        "Δ AM mean {} · Δ FM mean {}",
        fmt_opt(am.stats.mean),
        fmt_opt(fm.stats.mean)
    );
    let max_abs = match (am.stats.max_abs, fm.stats.max_abs) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (x, y) => x.or(y),
    };
    ModulationDelta {
        header: DeltaHeader { summary, max_abs },
        rate_hz: a.mod_freqs.clone(),
        am,
        fm,
    }
}

fn line_delta(a: &[f32], b: &[f32]) -> LineDelta {
    let bins = a.len().min(b.len());
    let pairs: Vec<(f32, f32)> = (0..bins).map(|i| (a[i], b[i])).collect();
    let values = pairs.iter().map(|(a, b)| b - a).collect();
    LineDelta {
        stats: DeltaStats::of(&pairs),
        values,
    }
}

// --- waveform ---------------------------------------------------------------

/// The envelope delta over the common span (M25.B).
///
/// Buckets are a fixed count per window with a length-dependent step, so clipping does
/// not align them by index. The delta samples the other envelope at **A's** bucket
/// times (nearest within one bucket), which is exact when the durations match.
pub(super) fn waveform_delta(
    a: &WaveformResult,
    a_times: &[f32],
    b: &WaveformResult,
    b_times: &[f32],
    span: Option<Span>,
) -> WaveformDelta {
    let tol = hop_of(a_times).max(hop_of(b_times)).max(1e-6);
    let mut times = Vec::new();
    let mut values = Vec::new();
    let mut pairs = Vec::new();
    let mut cursor = 0usize;
    for (frame, &time) in a_times.iter().enumerate() {
        if !in_span(time, span) {
            continue;
        }
        let Some(b_frame) = nearest(b_times, time, &mut cursor) else {
            continue;
        };
        if (b_times[b_frame] - time).abs() > tol {
            continue;
        }
        let value_a = a.max.get(frame).copied().unwrap_or(0.0);
        let value_b = b.max.get(b_frame).copied().unwrap_or(0.0);
        times.push(time);
        values.push(value_b - value_a);
        pairs.push((value_a, value_b));
    }
    let stats = DeltaStats::of(&pairs);
    let matched = times.len();
    let summary = format!("{} · {matched} buckets", stats.describe());
    WaveformDelta {
        header: DeltaHeader::new(summary, &stats),
        buckets: matched,
        times,
        values,
    }
}

// --- scalar readouts --------------------------------------------------------

pub(super) fn scalar_delta(a: &AnalysisResult, b: &AnalysisResult) -> ScalarDelta {
    let fields = match (a, b) {
        (AnalysisResult::Levels(a), AnalysisResult::Levels(b)) => levels_fields(a, b),
        (AnalysisResult::LoudnessIntegrated(a), AnalysisResult::LoudnessIntegrated(b)) => {
            lufs_fields(a, b)
        }
        (AnalysisResult::LoudnessRange(a), AnalysisResult::LoudnessRange(b)) => lra_fields(a, b),
        _ => generic_fields(a, b),
    };
    let summary = fields
        .iter()
        .map(|field| format!("Δ {} {:+}", field.key, field.delta))
        .collect::<Vec<_>>()
        .join(" · ");
    let max_abs = fields
        .iter()
        .map(|field| field.delta.abs() as f32)
        .reduce(f32::max);
    ScalarDelta {
        header: DeltaHeader {
            summary: if summary.is_empty() {
                "no comparable fields".to_string()
            } else {
                summary
            },
            max_abs,
        },
        fields,
    }
}

fn field(key: &str, a: f64, b: f64) -> FieldDelta {
    FieldDelta {
        key: key.to_string(),
        a,
        b,
        delta: b - a,
    }
}

fn levels_fields(a: &LevelsResult, b: &LevelsResult) -> Vec<FieldDelta> {
    vec![
        field("peak", f64::from(a.peak), f64::from(b.peak)),
        field("rms", f64::from(a.rms), f64::from(b.rms)),
        field("peakDb", f64::from(a.peak_db), f64::from(b.peak_db)),
        field("rmsDb", f64::from(a.rms_db), f64::from(b.rms_db)),
    ]
}

fn lufs_fields(a: &LufsResult, b: &LufsResult) -> Vec<FieldDelta> {
    vec![field("lufs", f64::from(a.lufs), f64::from(b.lufs))]
}

fn lra_fields(a: &LraResult, b: &LraResult) -> Vec<FieldDelta> {
    vec![field("lra", f64::from(a.lra), f64::from(b.lra))]
}

/// Any numeric field both scalar results share (a future-proof fallback).
fn generic_fields(a: &AnalysisResult, b: &AnalysisResult) -> Vec<FieldDelta> {
    let (Ok(a), Ok(b)) = (serde_json::to_value(a), serde_json::to_value(b)) else {
        return Vec::new();
    };
    let (Some(a), Some(b)) = (a.as_object(), b.as_object()) else {
        return Vec::new();
    };
    a.iter()
        .filter_map(|(key, value)| {
            if key == "tool" {
                return None;
            }
            let b_value = b.get(key)?;
            Some(field(key, value.as_f64()?, b_value.as_f64()?))
        })
        .collect()
}
