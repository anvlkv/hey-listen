//! Event and note pairing (M25).
//!
//! Event lists are paired by **nearest time** within a tolerance, never by index: the
//! two windows may start at different points, so frame 0 means different instants.
//! Matched pairs, only-A and only-B are all reported — an event that exists on one
//! side only is the interesting part of a comparison. See `docs/comparison.md`.

use serde::Serialize;

use crate::audio::analysis::{NoteMetricsResult, RhythmResult, SeriesResult};

use super::align::Span;
use super::diff::{hop_of, series_delta, SeriesDelta};
use super::stats::DeltaHeader;

/// The default pairing tolerance for note spans (no hop is carried by the result).
const NOTE_TOLERANCE_SECS: f32 = 0.05;
/// The floor for event pairing, so a very fine hop does not demand sample accuracy.
const MIN_EVENT_TOLERANCE_SECS: f32 = 0.02;

/// One matched event pair.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPair {
    pub a: f32,
    pub b: f32,
    /// `B − A`, in seconds.
    pub dt: f32,
}

/// How two event lists line up.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPairing {
    pub matched: usize,
    pub only_a: usize,
    pub only_b: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_abs_dt: Option<f32>,
    pub pairs: Vec<EventPair>,
    pub only_a_times: Vec<f32>,
    pub only_b_times: Vec<f32>,
}

impl EventPairing {
    fn describe(&self) -> String {
        let mean = self
            .mean_abs_dt
            .map(|dt| format!(" · mean |Δt| {:.1} ms", dt * 1_000.0))
            .unwrap_or_default();
        format!(
            "{} matched · {} only A · {} only B{mean}",
            self.matched, self.only_a, self.only_b
        )
    }
}

/// Rhythm delta: the onset-strength envelope (when the grids match) plus paired events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    /// The envelope delta; absent when the two frame grids differ.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub envelope: Option<SeriesDelta>,
    pub onsets: EventPairing,
    pub beats: EventPairing,
    pub downbeats: EventPairing,
}

/// One matched note pair, with the spans' deltas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePair {
    pub a_start: f32,
    pub b_start: f32,
    pub dt: f32,
    pub a_duration: f32,
    pub b_duration: f32,
    pub duration_delta: f32,
    pub a_rms_db: f32,
    pub b_rms_db: f32,
    pub rms_delta_db: f32,
}

/// `noteMetrics` delta: paired notes plus a matched/unmatched summary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesDelta {
    #[serde(flatten)]
    pub header: DeltaHeader,
    pub matched: usize,
    pub only_a: usize,
    pub only_b: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_abs_dt: Option<f32>,
    pub pairs: Vec<NotePair>,
    pub only_a_starts: Vec<f32>,
    pub only_b_starts: Vec<f32>,
}

pub(super) fn events_delta(
    a: &RhythmResult,
    b: &RhythmResult,
    overlap: Option<Span>,
    max_hop: f32,
) -> EventsDelta {
    let tol = (max_hop * 2.0).max(MIN_EVENT_TOLERANCE_SECS);
    let onsets = pair_times(&a.onset_times, &b.onset_times, tol, overlap);
    let beats = pair_times(&a.beat_times, &b.beat_times, tol, overlap);
    let downbeats = pair_times(&a.downbeat_times, &b.downbeat_times, tol, overlap);
    let envelope = envelope_delta(a, b, overlap);
    let summary = format!(
        "onsets {} · beats {} · downbeats {}",
        onsets.describe(),
        beats.describe(),
        downbeats.describe()
    );
    let max_abs = envelope.as_ref().and_then(|delta| delta.stats.max_abs);
    EventsDelta {
        header: DeltaHeader { summary, max_abs },
        envelope,
        onsets,
        beats,
        downbeats,
    }
}

/// The onset-strength envelope as a series delta, when both hops agree.
fn envelope_delta(
    a: &RhythmResult,
    b: &RhythmResult,
    overlap: Option<Span>,
) -> Option<SeriesDelta> {
    let hop_a = hop_of(&a.times);
    let hop_b = hop_of(&b.times);
    if hop_a > 0.0 && hop_b > 0.0 && (hop_a - hop_b).abs() > hop_a.max(hop_b) * 0.05 {
        return None;
    }
    Some(series_delta(&as_series(a), &as_series(b), overlap))
}

/// View a rhythm result's envelope as a series result (the delta code is shared).
fn as_series(r: &RhythmResult) -> SeriesResult {
    let values: Vec<Option<f32>> = r.onset_strength.iter().copied().map(Some).collect();
    let min_value = r
        .onset_strength
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let max_value = r
        .onset_strength
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    SeriesResult {
        sample_rate: 0,
        hop_size: r.hop_size,
        frames: r.times.len(),
        times: r.times.clone(),
        window_start: r.window_start,
        values,
        min_value: if min_value.is_finite() {
            min_value
        } else {
            0.0
        },
        max_value: if max_value.is_finite() {
            max_value
        } else {
            0.0
        },
        frame_size: None,
        gate: None,
    }
}

pub(super) fn notes_delta(
    a: &NoteMetricsResult,
    b: &NoteMetricsResult,
    overlap: Option<Span>,
) -> NotesDelta {
    let notes_a = &a.notes;
    let notes_b = &b.notes;
    let starts_a: Vec<f32> = notes_a.iter().map(|note| note.start_secs).collect();
    let starts_b: Vec<f32> = notes_b.iter().map(|note| note.start_secs).collect();
    let pairing = pair_indices(&starts_a, &starts_b, NOTE_TOLERANCE_SECS, overlap);

    let mut pairs = Vec::with_capacity(pairing.0.len());
    let mut dt_total = 0.0f32;
    for (index_a, index_b) in &pairing.0 {
        let note_a = &notes_a[*index_a];
        let note_b = &notes_b[*index_b];
        let dt = note_b.start_secs - note_a.start_secs;
        dt_total += dt.abs();
        pairs.push(NotePair {
            a_start: note_a.start_secs,
            b_start: note_b.start_secs,
            dt,
            a_duration: note_a.duration_secs,
            b_duration: note_b.duration_secs,
            duration_delta: note_b.duration_secs - note_a.duration_secs,
            a_rms_db: note_a.rms_db,
            b_rms_db: note_b.rms_db,
            rms_delta_db: note_b.rms_db - note_a.rms_db,
        });
    }
    let only_a_starts: Vec<f32> = pairing
        .1
        .iter()
        .map(|index| notes_a[*index].start_secs)
        .collect();
    let only_b_starts: Vec<f32> = pairing
        .2
        .iter()
        .map(|index| notes_b[*index].start_secs)
        .collect();
    let matched = pairs.len();
    let mean_abs_dt = (matched > 0).then(|| dt_total / matched as f32);
    let summary = format!(
        "{matched} matched · {} only A · {} only B",
        only_a_starts.len(),
        only_b_starts.len()
    );
    let max_abs = pairs
        .iter()
        .map(|pair| pair.rms_delta_db.abs())
        .reduce(f32::max);
    NotesDelta {
        header: DeltaHeader { summary, max_abs },
        matched,
        only_a: only_a_starts.len(),
        only_b: only_b_starts.len(),
        mean_abs_dt,
        pairs,
        only_a_starts,
        only_b_starts,
    }
}

/// Pair two event lists by nearest time within `tol`, restricted to `overlap`.
fn pair_times(a: &[f32], b: &[f32], tol: f32, overlap: Option<Span>) -> EventPairing {
    let (pairs, only_a, only_b) = pair(a, b, tol, overlap);
    let matched = pairs.len();
    let mean_abs_dt = if matched > 0 {
        Some(
            pairs
                .iter()
                .map(|pair: &EventPair| pair.dt.abs())
                .sum::<f32>()
                / matched as f32,
        )
    } else {
        None
    };
    EventPairing {
        matched,
        only_a: only_a.len(),
        only_b: only_b.len(),
        mean_abs_dt,
        pairs,
        only_a_times: only_a,
        only_b_times: only_b,
    }
}

/// The pairing core over two sorted time lists: matched pairs plus the unmatched.
fn pair(
    a: &[f32],
    b: &[f32],
    tol: f32,
    overlap: Option<Span>,
) -> (Vec<EventPair>, Vec<f32>, Vec<f32>) {
    let (index_pairs, only_a, only_b) = pair_indices(a, b, tol, overlap);
    let pairs = index_pairs
        .into_iter()
        .map(|(index_a, index_b)| EventPair {
            a: a[index_a],
            b: b[index_b],
            dt: b[index_b] - a[index_a],
        })
        .collect();
    (
        pairs,
        only_a.into_iter().map(|index| a[index]).collect(),
        only_b.into_iter().map(|index| b[index]).collect(),
    )
}

/// Pair two sorted lists by nearest time: `(pairs, only_a, only_b)` of indices.
fn pair_indices(
    a: &[f32],
    b: &[f32],
    tol: f32,
    overlap: Option<Span>,
) -> (Vec<(usize, usize)>, Vec<usize>, Vec<usize>) {
    let in_overlap = |time: f32| overlap.is_none_or(|span| span.contains(time));
    let mut used = vec![false; b.len()];
    let mut pairs = Vec::new();
    let mut only_a = Vec::new();
    let mut cursor = 0usize;

    for (index_a, &time_a) in a.iter().enumerate() {
        if !in_overlap(time_a) {
            continue;
        }
        let Some(index_b) = nearest_unused(b, time_a, &mut cursor, &used) else {
            only_a.push(index_a);
            continue;
        };
        if (b[index_b] - time_a).abs() <= tol {
            used[index_b] = true;
            pairs.push((index_a, index_b));
        } else {
            only_a.push(index_a);
        }
    }

    let only_b = b
        .iter()
        .enumerate()
        .filter(|(index, &time)| !used[*index] && in_overlap(time))
        .map(|(index, _)| index)
        .collect();
    (pairs, only_a, only_b)
}

/// The nearest not-yet-used index in `b`, scanning a few neighbours around `cursor`.
fn nearest_unused(b: &[f32], time: f32, cursor: &mut usize, used: &[bool]) -> Option<usize> {
    if b.is_empty() {
        return None;
    }
    *cursor = (*cursor).min(b.len() - 1);
    // Move forward while the next candidate is strictly closer (or the current is used).
    while *cursor + 1 < b.len()
        && ((b[*cursor + 1] - time).abs() < (b[*cursor] - time).abs() || used[*cursor])
    {
        *cursor += 1;
    }
    // A used nearest neighbour can hide an unused one just behind it.
    let lo = cursor.saturating_sub(4);
    let hi = (*cursor + 4).min(b.len() - 1);
    (lo..=hi).filter(|&index| !used[index]).min_by(|&x, &y| {
        (b[x] - time)
            .abs()
            .partial_cmp(&(b[y] - time).abs())
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}
