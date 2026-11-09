//! Note segmentation (M18): detect acoustic **notes** from a frame-RMS envelope,
//! keep the gaps between them explicit, and summarize each note's level.
//!
//! These are audio **note segments** — not the project's user-authored **annotations**
//! (the M14 `Annotation` payload). See `docs/analysis-metrics.md` → M18.

use super::super::support::{db_or_floor, frame_rms};
use super::super::{
    GapMetric, NoteMetric, NoteMetricsResult, SyllableMetric, ToolOptions, DB_FLOOR, MAX_NOTES,
};
use super::note_quality;

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
///
/// Every surviving run is returned: the caller applies [`MAX_NOTES`] only to the
/// records it ships, so counts and gaps can stay honest about omitted activity.
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
            // A frame at the hold level keeps a note open, but only a frame strictly
            // above the threshold opens one: `gateFloorDb` may equal the −120 dBFS
            // silence sentinel, where an inclusive test would make digital silence a
            // note (every frame would open and hold one).
            Some(_) => db >= off_db,
            None => db > gate.threshold_db,
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
    merged
}

/// Note segmentation over the window (M18).
///
/// The gate is `max(gateFloorDb, windowPeakDb − gateDb)`; levels, gaps, the relative
/// levels against the loudest note, and a normalized per-note envelope are returned.
///
/// The counts, gap statistics and syllables describe **every** run the segmenter found;
/// only the returned records are bounded by [`MAX_NOTES`], so `note_count > notes.len()`
/// means the record list is truncated (never that the omitted activity was silence).
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
    let all_gaps: Vec<GapMetric> = segments
        .windows(2)
        .map(|pair| GapMetric {
            start_secs: pair[0].end,
            end_secs: pair[1].start,
            duration_secs: (pair[1].start - pair[0].end).max(0.0),
        })
        .collect();
    let note_durations: Vec<f32> = segments.iter().map(|span| span.end - span.start).collect();
    let gap_durations: Vec<f32> = all_gaps.iter().map(|gap| gap.duration_secs).collect();

    let points = options.envelope_points();
    let envelope_positions: Vec<f32> = (0..points)
        .map(|index| index as f32 / (points - 1) as f32)
        .collect();

    // Per-note levels from the raw samples (the frame grid only decides the spans).
    // Only the returned prefix becomes full records; its gaps still point at the next
    // *detected* note, so a truncated tail is not reported as silence.
    let shown = segments.len().min(MAX_NOTES);
    let mut notes: Vec<NoteMetric> = segments[..shown]
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            let (rms_db, peak_db) = segment_levels(mono, rate, segment.start, segment.end);
            let proxies = note_quality::proxies(mono, rate, *segment, options, &times, &levels);
            NoteMetric {
                start_secs: segment.start,
                end_secs: segment.end,
                duration_secs: segment.end - segment.start,
                gap_before_secs: gap_before(&segments, index),
                gap_after_secs: gap_after(&segments, index, duration),
                rms_db,
                peak_db,
                rms_db_rel_loudest: 0.0,
                peak_db_rel_loudest: 0.0,
                envelope_db: envelope_for(segment, &times, &levels, &envelope_positions),
                voiced_fraction: proxies.voiced_fraction,
                f0_median_hz: proxies.f0_median_hz,
                jitter_proxy_cents: proxies.jitter_proxy_cents,
                shimmer_proxy_db: proxies.shimmer_proxy_db,
                hnr_proxy: proxies.hnr_proxy,
            }
        })
        .collect();

    // The gap records that belong to the returned notes (the summary keeps the full set).
    let gaps: Vec<GapMetric> = all_gaps[..shown.saturating_sub(1)].to_vec();

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

    // Syllables are a grouping of the detected notes, never a change to their spans:
    // adjacent notes whose gap is shorter than `syllableGapMs` merge into one syllable
    // (M21.B). Off by default, so the result shape is unchanged. Grouping reads the full
    // run list, so truncating the records cannot split a syllable.
    let syllables = options.syllable_gap_ms().map(|gap_ms| {
        let mut syllables = group_syllables(&segments, gap_ms / 1_000.0, mono, rate);
        syllables.truncate(MAX_NOTES);
        syllables
    });

    NoteMetricsResult {
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        note_count: segments.len(),
        gap_count: all_gaps.len(),
        total_gap_secs: gap_durations.iter().sum(),
        longest_gap_secs: gap_durations.iter().copied().fold(0.0, f32::max),
        median_note_secs: median(&note_durations),
        median_gap_secs: median(&gap_durations),
        threshold_db: db_or_floor(threshold_db),
        envelope_positions,
        reference_note_index,
        notes,
        gaps,
        syllables,
    }
}

/// Group adjacent notes whose separating gap is at most `gap_secs` into syllables.
/// The notes keep their own spans; only the grouping is new, and each syllable's level
/// is measured over the merged span (amplitude belongs to the syllable).
fn group_syllables(
    spans: &[Segment],
    gap_secs: f32,
    mono: &[f32],
    sample_rate: u32,
) -> Vec<SyllableMetric> {
    let mut out: Vec<SyllableMetric> = Vec::new();
    for span in spans {
        match out.last_mut() {
            Some(last) if span.start - last.end_secs <= gap_secs => {
                last.end_secs = span.end;
                last.duration_secs = last.end_secs - last.start_secs;
                last.note_count += 1;
            }
            _ => out.push(SyllableMetric {
                start_secs: span.start,
                end_secs: span.end,
                duration_secs: span.end - span.start,
                note_count: 1,
                rms_db: DB_FLOOR,
                peak_db: DB_FLOOR,
            }),
        }
    }
    for syllable in &mut out {
        let (rms_db, peak_db) =
            segment_levels(mono, sample_rate, syllable.start_secs, syllable.end_secs);
        syllable.rms_db = rms_db;
        syllable.peak_db = peak_db;
    }
    out
}

/// Silence between the previous note and `index` (leading silence for the first).
fn gap_before(spans: &[Segment], index: usize) -> f32 {
    let previous_end = index
        .checked_sub(1)
        .map_or(0.0, |previous| spans[previous].end);
    (spans[index].start - previous_end).max(0.0)
}

/// Silence between `index` and the next note: the next detected note's start, or the
/// window end for the last one.
fn gap_after(spans: &[Segment], index: usize, duration: f32) -> f32 {
    let next_start = spans.get(index + 1).map_or(duration, |next| next.start);
    (next_start - spans[index].end).max(0.0)
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

/// Median of a set of values (0 for an empty set).
pub(super) fn median(values: &[f32]) -> f32 {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A frame-level envelope alternating well above / below a −40 dB gate, so each
    /// `on` frame is one note — far cheaper than rendering that many notes of audio.
    fn alternating(notes: usize) -> Vec<f32> {
        (0..notes * 2)
            .map(|index| {
                if index.is_multiple_of(2) {
                    -20.0
                } else {
                    -80.0
                }
            })
            .collect()
    }

    #[test]
    fn segmentation_keeps_every_run_for_honest_counts() {
        let levels = alternating(MAX_NOTES + 2);
        let duration = levels.len() as f32 / 1_000.0;
        let gate = Gate {
            threshold_db: -40.0,
            hysteresis_db: 0.0,
            min_note_secs: 0.0,
            min_gap_secs: 0.0,
        };
        let spans = segment_notes(&levels, 1, 1, 1_000, duration, &gate);
        assert_eq!(spans.len(), MAX_NOTES + 2, "the segmenter keeps every run");
        // The last *returned* note reports its gap to the next detected note, not the
        // rest of the window as though the omitted activity were silence.
        assert!((gap_after(&spans, MAX_NOTES - 1, duration) - 0.001).abs() < 1e-6);
    }
}
