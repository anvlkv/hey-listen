//! Note segmentation (M18): detect acoustic **notes** from a frame-RMS envelope,
//! keep the gaps between them explicit, and summarize each note's level.
//!
//! These are audio **note segments** — not the project's user-authored **annotations**
//! (the M14 `Note` payload). See `docs/analysis-metrics.md` → M18.

use super::super::support::{db_or_floor, frame_rms};
use super::super::{GapMetric, NoteMetric, NoteMetricsResult, ToolOptions, DB_FLOOR, MAX_NOTES};

/// One active run above the gate, in source seconds relative to the window slice.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Segment {
    pub start: f32,
    pub end: f32,
}

/// The hysteresis gate and duration rules applied to a frame-level envelope.
#[derive(Debug, Clone, Copy)]
pub(super) struct Gate {
    /// Level a frame must reach to open a note.
    pub threshold_db: f32,
    /// A note stays open until the level falls this far under the threshold.
    pub hysteresis_db: f32,
    pub min_note_secs: f32,
    pub min_gap_secs: f32,
}

/// Segment a frame-level envelope into notes: open above `threshold_db`, close
/// `hysteresis_db` below it, merge runs separated by less than `min_gap_secs`, then
/// drop runs shorter than `min_note_secs`.
pub(super) fn segment_notes(
    frame_db: &[f32],
    frame: usize,
    hop: usize,
    sample_rate: u32,
    duration: f32,
    gate: &Gate,
) -> Vec<Segment> {
    if frame_db.is_empty() || frame == 0 || hop == 0 {
        return Vec::new();
    }
    let rate = f64::from(sample_rate.max(1));
    let off_db = gate.threshold_db - gate.hysteresis_db.max(0.0);

    // Raw active runs as frame-index ranges.
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut active: Option<(usize, usize)> = None;
    for (index, &db) in frame_db.iter().enumerate() {
        let above = match active {
            Some(_) => db >= off_db,
            None => db >= gate.threshold_db,
        };
        if above {
            match &mut active {
                Some((_, last)) => *last = index,
                None => active = Some((index, index)),
            }
        } else if let Some((first, last)) = active.take() {
            runs.push((first, last));
        }
    }
    if let Some(run) = active {
        runs.push(run);
    }

    // Frame ranges -> seconds; a frame covers `[start, start + frame)`.
    let mut segments: Vec<Segment> = runs
        .into_iter()
        .filter_map(|(first, last)| {
            let start = (first * hop) as f64 / rate;
            let end = ((last * hop + frame) as f64 / rate).min(f64::from(duration));
            (end > start).then_some(Segment {
                start: start as f32,
                end: end as f32,
            })
        })
        .collect();

    // Merge runs whose separation is shorter than the minimum gap.
    let mut merged: Vec<Segment> = Vec::with_capacity(segments.len());
    for segment in segments.drain(..) {
        match merged.last_mut() {
            Some(previous) if segment.start - previous.end < gate.min_gap_secs => {
                previous.end = segment.end;
            }
            _ => merged.push(segment),
        }
    }

    // Drop notes that are too short to be one.
    merged.retain(|segment| segment.end - segment.start >= gate.min_note_secs);
    merged.truncate(MAX_NOTES);
    merged
}

/// Note segmentation over the window (M18).
///
/// The gate is `max(gateFloorDb, windowPeakDb − gateDb)`; levels, gaps, the relative
/// levels against the loudest note, and a normalized per-note envelope are returned.
pub fn note_metrics(mono: &[f32], sample_rate: u32, options: &ToolOptions) -> NoteMetricsResult {
    let (times, levels, frame, hop) =
        frame_rms(mono, sample_rate, options.frame_ms(), options.hop_ms());
    let rate = sample_rate.max(1);
    let duration = mono.len() as f32 / rate as f32;
    let peak_db = levels.iter().copied().fold(DB_FLOOR, f32::max);
    let threshold_db = (peak_db - options.gate_db()).max(options.gate_floor_db());
    let gate = Gate {
        threshold_db,
        hysteresis_db: options.hysteresis_db(),
        min_note_secs: options.min_note_ms() / 1_000.0,
        min_gap_secs: options.min_gap_ms() / 1_000.0,
    };
    let segments = segment_notes(&levels, frame, hop, rate, duration, &gate);
    let points = options.envelope_points();
    let envelope_positions: Vec<f32> = (0..points)
        .map(|index| index as f32 / (points - 1) as f32)
        .collect();

    // Per-note levels from the raw samples (the frame grid only decides the spans).
    let mut notes: Vec<NoteMetric> = segments
        .iter()
        .map(|segment| {
            let (rms_db, peak_db) = segment_levels(mono, rate, segment.start, segment.end);
            NoteMetric {
                start_secs: segment.start,
                end_secs: segment.end,
                duration_secs: segment.end - segment.start,
                gap_before_secs: 0.0,
                gap_after_secs: 0.0,
                rms_db,
                peak_db,
                rms_db_rel_loudest: 0.0,
                peak_db_rel_loudest: 0.0,
                envelope_db: envelope_for(segment, &times, &levels, &envelope_positions),
            }
        })
        .collect();

    // Gaps between notes (leading / trailing silence lives on the edge notes).
    let gaps: Vec<GapMetric> = notes
        .windows(2)
        .map(|pair| GapMetric {
            start_secs: pair[0].end_secs,
            end_secs: pair[1].start_secs,
            duration_secs: (pair[1].start_secs - pair[0].end_secs).max(0.0),
        })
        .collect();

    for index in 0..notes.len() {
        let before = if index == 0 {
            notes[index].start_secs
        } else {
            notes[index].start_secs - notes[index - 1].end_secs
        };
        let after = if index + 1 == notes.len() {
            duration - notes[index].end_secs
        } else {
            notes[index + 1].start_secs - notes[index].end_secs
        };
        notes[index].gap_before_secs = before.max(0.0);
        notes[index].gap_after_secs = after.max(0.0);
    }

    // The loudest note is the level reference.
    let reference_note_index = notes
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.rms_db.total_cmp(&b.rms_db))
        .map(|(index, _)| index);
    let reference = reference_note_index.map(|index| (notes[index].rms_db, notes[index].peak_db));
    if let Some((ref_rms, ref_peak)) = reference {
        for note in &mut notes {
            note.rms_db_rel_loudest = note.rms_db - ref_rms;
            note.peak_db_rel_loudest = note.peak_db - ref_peak;
        }
    }

    let note_durations: Vec<f32> = notes.iter().map(|note| note.duration_secs).collect();
    let gap_durations: Vec<f32> = gaps.iter().map(|gap| gap.duration_secs).collect();

    NoteMetricsResult {
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        note_count: notes.len(),
        gap_count: gaps.len(),
        total_gap_secs: gap_durations.iter().sum(),
        longest_gap_secs: gap_durations.iter().copied().fold(0.0, f32::max),
        median_note_secs: median(&note_durations),
        median_gap_secs: median(&gap_durations),
        threshold_db: db_or_floor(threshold_db),
        envelope_positions,
        reference_note_index,
        notes,
        gaps,
    }
}

/// RMS and peak levels, in dBFS, over `[start, end)` of the raw samples.
fn segment_levels(mono: &[f32], sample_rate: u32, start: f32, end: f32) -> (f32, f32) {
    let first = ((start.max(0.0) * sample_rate as f32).floor() as usize).min(mono.len());
    let last = ((end.max(0.0) * sample_rate as f32).ceil() as usize).min(mono.len());
    let slice = &mono[first..last.max(first)];
    if slice.is_empty() {
        return (DB_FLOOR, DB_FLOOR);
    }
    let sum: f64 = slice.iter().map(|&sample| f64::from(sample).powi(2)).sum();
    let rms = (sum / slice.len() as f64).sqrt() as f32;
    let peak = slice.iter().fold(0.0f32, |peak, &s| peak.max(s.abs()));
    (amplitude_db(rms), amplitude_db(peak))
}

fn amplitude_db(amplitude: f32) -> f32 {
    if amplitude > 0.0 {
        db_or_floor(20.0 * amplitude.log10())
    } else {
        DB_FLOOR
    }
}

/// The segment's frame levels at the normalized envelope positions.
fn envelope_for(segment: &Segment, times: &[f32], levels: &[f32], positions: &[f32]) -> Vec<f32> {
    if times.is_empty() {
        return vec![DB_FLOOR; positions.len()];
    }
    // The frames covering the segment (times are sorted).
    let first = times.partition_point(|time| *time < segment.start);
    let last = times.partition_point(|time| *time <= segment.end);
    let first = first.min(times.len() - 1);
    let last = last.max(first + 1).min(times.len());
    positions
        .iter()
        .map(|position| {
            let time = segment.start + position * (segment.end - segment.start);
            let mut best = first;
            for index in first..last {
                if (times[index] - time).abs() < (times[best] - time).abs() {
                    best = index;
                }
            }
            levels[best]
        })
        .collect()
}

/// Median of a set of durations (0 for an empty set).
fn median(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f32::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}
