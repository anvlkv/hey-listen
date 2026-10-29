//! The per-family delta implementations (M25), split from [`super`] to keep each file
//! inside the source-size budget. Every family is covered, so MCP and the CLI can
//! compare any tool; the **views** for matrix/events/notes/modulation/waveform land in
//! M25.A. See `docs/comparison.md` → "The delta".

use crate::audio::analysis::{
    AnalysisResult, LevelsResult, LraResult, LufsResult, MatrixResult, SeriesResult,
    SpectrogramResult, SpectrumResult, WaveformResult,
};

use super::super::align::Span;
use super::super::stats::{DeltaHeader, DeltaStats};
use super::{fmt_opt, ScalarDelta, SeriesDelta, SpectrumDelta, WaveformDelta};
use super::{hop_of, in_overlap, nearest, FieldDelta, LineDelta, MatrixDelta, ModulationDelta};

// --- series -----------------------------------------------------------------

/// A series delta over the frames present in `overlap` (all frames when `None`).
pub fn series_delta(a: &SeriesResult, b: &SeriesResult, overlap: Option<Span>) -> SeriesDelta {
    let tol = hop_of(&a.times).max(hop_of(&b.times)).max(1e-4) * 0.6;
    let mut times = Vec::new();
    let mut values = Vec::new();
    let mut a_values = Vec::new();
    let mut b_values = Vec::new();
    let mut pairs = Vec::new();
    let mut cursor = 0usize;
    for (index, &time) in a.times.iter().enumerate() {
        if !in_overlap(time, overlap) {
            continue;
        }
        let Some(value_a) = a.values.get(index).copied().flatten() else {
            continue;
        };
        let Some(b_index) = nearest(&b.times, time, &mut cursor) else {
            continue;
        };
        if (b.times[b_index] - time).abs() > tol {
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
    b: &MatrixResult,
    overlap: Option<Span>,
) -> MatrixDelta {
    let bins = a.bins.min(b.bins);
    let tol = hop_of(&a.times).max(hop_of(&b.times)).max(1e-4) * 0.6;
    let mut times = Vec::new();
    let mut values = Vec::new();
    let mut pairs = Vec::new();
    let mut cursor = 0usize;
    for (frame, &time) in a.times.iter().enumerate() {
        if !in_overlap(time, overlap) {
            continue;
        }
        let Some(b_frame) = nearest(&b.times, time, &mut cursor) else {
            continue;
        };
        if (b.times[b_frame] - time).abs() > tol {
            continue;
        }
        times.push(time);
        for band in 0..bins {
            let value_a = a.values.get(frame * a.bins + band).copied().unwrap_or(0.0);
            let value_b = b
                .values
                .get(b_frame * b.bins + band)
                .copied()
                .unwrap_or(0.0);
            values.push(value_b - value_a);
            pairs.push((value_a, value_b));
        }
    }
    let stats = DeltaStats::of(&pairs);
    let summary = format!("{} · {}×{bins}", stats.describe(), times.len());
    MatrixDelta {
        header: DeltaHeader::new(summary, &stats),
        stats,
        times,
        bins,
        values,
    }
}

/// A spectrogram's frame times are implicit (`window_start + frame · hop / rate`).
fn spectrogram_frames(r: &SpectrogramResult) -> Vec<f32> {
    let hop = r.hop_size as f64 / f64::from(r.sample_rate.max(1));
    (0..r.frames)
        .map(|frame| (r.window_start + frame as f64 * hop) as f32)
        .collect()
}

pub(super) fn spectrogram_delta(
    a: &SpectrogramResult,
    b: &SpectrogramResult,
    overlap: Option<Span>,
) -> MatrixDelta {
    let bins = a.bins.min(b.bins);
    let times_a = spectrogram_frames(a);
    let times_b = spectrogram_frames(b);
    let hop = (a.hop_size as f64 / f64::from(a.sample_rate.max(1))).max(1e-4);
    let tol = (hop as f32) * 0.6;
    let mut times = Vec::new();
    let mut values = Vec::new();
    let mut pairs = Vec::new();
    let mut cursor = 0usize;
    for (frame, &time) in times_a.iter().enumerate() {
        if !in_overlap(time, overlap) {
            continue;
        }
        let Some(b_frame) = nearest(&times_b, time, &mut cursor) else {
            continue;
        };
        if (times_b[b_frame] - time).abs() > tol {
            continue;
        }
        times.push(time);
        for band in 0..bins {
            let value_a = a.mag_db.get(frame * a.bins + band).copied().unwrap_or(0.0);
            let value_b = b
                .mag_db
                .get(b_frame * b.bins + band)
                .copied()
                .unwrap_or(0.0);
            values.push(value_b - value_a);
            pairs.push((value_a, value_b));
        }
    }
    let stats = DeltaStats::of(&pairs);
    let summary = format!("{} · {}×{bins}", stats.describe(), times.len());
    MatrixDelta {
        header: DeltaHeader::new(summary, &stats),
        stats,
        times,
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

pub(super) fn waveform_delta(
    a: &WaveformResult,
    b: &WaveformResult,
    a_span: Span,
    b_span: Span,
) -> WaveformDelta {
    let same_window = (a_span.start - b_span.start).abs() < 1e-6
        && (a_span.end - b_span.end).abs() < 1e-6
        && a.max.len() == b.max.len()
        && !a.max.is_empty();
    if !same_window {
        return WaveformDelta {
            header: DeltaHeader::text(
                "the windows differ — bucket i covers a different span, so there is no envelope delta",
            ),
            buckets: 0,
            values: Vec::new(),
        };
    }
    let pairs: Vec<(f32, f32)> = a.max.iter().copied().zip(b.max.iter().copied()).collect();
    let values = pairs.iter().map(|(a, b)| b - a).collect();
    let stats = DeltaStats::of(&pairs);
    let summary = format!("{} · {} buckets", stats.describe(), pairs.len());
    WaveformDelta {
        header: DeltaHeader::new(summary, &stats),
        buckets: pairs.len(),
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
