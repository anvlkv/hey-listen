//! The compact (`Shape::Compact`) family shapes, split out of `shape.rs` for the
//! source-size budget.
//!
//! Every function here keeps a family's scalars, its dimensions and its peak location
//! while the big numeric arrays become `{ length, min, max, argmin, argmax }` (plus
//! `nulls` when a series has gaps) and the object/event lists become a bounded preview
//! of `preview_records` records.

use serde::Serialize;
use serde_json::{Map, Value};

use super::{
    candidates, grid, insert, matrix_peak, spectrogram_peak, stats_f32, stats_gaps, time_axis,
};
use crate::audio::analysis::{
    AnalysisResult, CalibratedSeriesResult, LoudnessResult, MaskingResult, MatrixResult,
    NoteMetric, NoteMetricsResult, PitchResult, RhythmResult, SeriesResult, SpectrogramResult,
    SpectrumResult, WaveformResult,
};

/// A structurally compact result: scalars are kept, big numeric arrays become stats, and
/// object lists become a bounded preview of `preview_records` records.
pub(super) fn compact_with(result: &AnalysisResult, preview_records: usize) -> Value {
    let mut value = serde_json::to_value(result).unwrap_or(Value::Null);
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    match result {
        AnalysisResult::Waveform(r) => compact_waveform(object, r),
        AnalysisResult::Spectrum(r) => compact_spectrum(object, r),
        AnalysisResult::Masking(r) => compact_masking(object, r, preview_records),
        AnalysisResult::Spectrogram(r) => compact_spectrogram(object, r),
        AnalysisResult::MelSpectrogram(r)
        | AnalysisResult::Mfcc(r)
        | AnalysisResult::Chromagram(r)
        | AnalysisResult::SpectralContrast(r)
        | AnalysisResult::CriticalBands(r)
        | AnalysisResult::SpecificLoudness(r) => compact_matrix(object, r),
        AnalysisResult::Loudness(r) => compact_loudness(object, r),
        AnalysisResult::PitchPyin(r)
        | AnalysisResult::PitchYin(r)
        | AnalysisResult::PitchAutocorr(r) => compact_pitch(object, r),
        AnalysisResult::Tempo(r) | AnalysisResult::Onsets(r) | AnalysisResult::Downbeats(r) => {
            compact_rhythm(object, r, preview_records)
        }
        AnalysisResult::NoteMetrics(r) => compact_notes(object, r, preview_records),
        AnalysisResult::Spatial(r) => {
            insert(object, "times", time_axis(&r.times));
            insert(object, "values", stats_gaps(&r.values));
        }
        AnalysisResult::Modulation(r) => {
            insert(object, "modFreqs", stats_f32(&r.mod_freqs));
            insert(object, "amDb", stats_f32(&r.am_db));
            insert(object, "fmDb", stats_f32(&r.fm_db));
        }
        other => {
            // Every scalar-per-frame tool shares one compact shape; the calibrated
            // series has its own (same arrays plus the calibration state), and the
            // scalar readouts (levels, integrated loudness, LRA) pass through unchanged.
            if let Some(r) = other.series() {
                compact_gapped_series(object, r);
            } else if let Some(r) = other.calibrated_series() {
                compact_calibrated_series(object, r);
            }
        }
    }
    value
}

fn compact_waveform(object: &mut Map<String, Value>, r: &WaveformResult) {
    insert(object, "min", stats_f32(&r.min));
    insert(object, "max", stats_f32(&r.max));
    insert(object, "bucketRms", stats_f32(&r.bucket_rms));
}

fn compact_spectrum(object: &mut Map<String, Value>, r: &SpectrumResult) {
    insert(object, "freqs", stats_f32(&r.freqs));
    insert(object, "magDb", stats_f32(&r.mag_db));
    insert(object, "minDb", stats_f32(&r.min_db));
    insert(object, "maxDb", stats_f32(&r.max_db));
}

/// The masking curves become stats; `calibrated` / `calibrationDbSpl` stay as-is, and
/// the masker list is previewed like any other object list (M36).
fn compact_masking(object: &mut Map<String, Value>, r: &MaskingResult, preview_records: usize) {
    insert(object, "freqs", stats_f32(&r.freqs));
    insert(object, "spectrumDb", stats_f32(&r.spectrum_db));
    insert(object, "thresholdQuietDb", stats_f32(&r.threshold_quiet_db));
    insert(object, "globalMaskDb", stats_f32(&r.global_mask_db));
    insert(object, "smrDb", stats_f32(&r.smr_db));
    insert(object, "maskers", preview(&r.maskers, preview_records));
}

fn compact_spectrogram(object: &mut Map<String, Value>, r: &SpectrogramResult) {
    insert(object, "freqs", stats_f32(&r.freqs));
    insert(object, "magDb", stats_f32(&r.mag_db));
    if let Some((_, bin, time, level)) = spectrogram_peak(r) {
        insert(object, "peakTime", Value::from(time));
        if let Some(hz) = r.freqs.get(bin) {
            insert(object, "peakHz", Value::from(f64::from(*hz)));
        }
        insert(object, "peakDb", Value::from(f64::from(level)));
    }
}

fn compact_matrix(object: &mut Map<String, Value>, r: &MatrixResult) {
    insert(object, "times", time_axis(&r.times));
    if let Some((frame, band, value)) = matrix_peak(r) {
        insert(object, "peakFrame", Value::from(frame));
        insert(object, "peakBand", Value::from(band));
        insert(object, "peakValue", Value::from(f64::from(value)));
        if let Some(time) = r.times.get(frame) {
            insert(object, "peakTime", Value::from(f64::from(*time)));
        }
    }
    insert(object, "values", stats_f32(&r.values));
}

fn compact_gapped_series(object: &mut Map<String, Value>, r: &SeriesResult) {
    insert(object, "times", time_axis(&r.times));
    insert(object, "values", stats_gaps(&r.values));
}

/// The sone and phon tracks become stats; `calibrated` / `calibrationDbSpl` stay as-is.
/// The RMS/SPL comparator is parallel to `times`, and an absent vector (an uncalibrated
/// run has no SPL) must stay absent instead of becoming an empty stats object.
fn compact_loudness(object: &mut Map<String, Value>, r: &LoudnessResult) {
    insert(object, "times", time_axis(&r.times));
    insert(object, "loudnessSone", stats_gaps(&r.loudness_sone));
    insert(object, "loudnessPhon", stats_gaps(&r.loudness_phon));
    for (key, levels) in [
        ("frameRmsDb", &r.frame_rms_db),
        ("frameSplDb", &r.frame_spl_db),
    ] {
        if !levels.is_empty() {
            insert(object, key, stats_gaps(levels));
        }
    }
}

/// The sharpness track becomes stats; `calibrated` / `calibrationDbSpl` stay as-is. The
/// drill-down grids are compacted with it, so a compact result never carries a full
/// `frames × bins` or `frames × bands × rates` array (M36).
fn compact_calibrated_series(object: &mut Map<String, Value>, r: &CalibratedSeriesResult) {
    insert(object, "times", time_axis(&r.times));
    insert(object, "values", stats_gaps(&r.values));
    if let Some(contribution) = &r.contribution {
        insert(
            object,
            "contribution",
            grid::compact_contribution(contribution),
        );
    }
    if let Some(rates) = &r.rate_contribution {
        insert(
            object,
            "rateContribution",
            grid::compact_rate_contribution(rates),
        );
    }
}

fn compact_pitch(object: &mut Map<String, Value>, r: &PitchResult) {
    insert(object, "times", time_axis(&r.times));
    insert(object, "values", stats_gaps(&r.values));
    insert(object, "confidence", stats_gaps(&r.confidence));
    if let Some(grid) = &r.candidates {
        insert(object, "candidates", candidates::compact(grid));
    }
    if !r.octave_ambiguous.is_empty() {
        insert(
            object,
            "octaveAmbiguous",
            candidates::compact_flags(&r.octave_ambiguous),
        );
    }
}

fn compact_rhythm(object: &mut Map<String, Value>, r: &RhythmResult, preview_records: usize) {
    insert(object, "times", time_axis(&r.times));
    insert(object, "onsetStrength", stats_f32(&r.onset_strength));
    insert(
        object,
        "onsetTimes",
        preview(&r.onset_times, preview_records),
    );
    insert(object, "beatTimes", preview(&r.beat_times, preview_records));
    insert(
        object,
        "downbeatTimes",
        preview(&r.downbeat_times, preview_records),
    );
}

fn compact_notes(object: &mut Map<String, Value>, r: &NoteMetricsResult, preview_records: usize) {
    insert(object, "notes", preview(&r.notes, preview_records));
    insert(object, "gaps", preview(&r.gaps, preview_records));
    // The event spans are the answer to "where are the events?" — keep them all, even
    // when the heavy per-note records are previewed. Without this an agent must switch
    // to a full result (and must not pass `maxPoints`, which would drop notes).
    let bounds: Vec<Value> = r.notes.iter().map(compact_note_bounds).collect();
    insert(object, "bounds", Value::Array(bounds));
}

fn compact_note_bounds(note: &NoteMetric) -> Value {
    serde_json::json!({
        "startSecs": note.start_secs,
        "endSecs": note.end_secs,
        "gapAfterSecs": note.gap_after_secs,
    })
}

/// A bounded preview of an object/event list: its length, the first `preview_records`
/// records, and whether anything was omitted.
fn preview<T: Serialize>(items: &[T], preview_records: usize) -> Value {
    let shown = items.len().min(preview_records);
    let records = serde_json::to_value(&items[..shown]).unwrap_or(Value::Null);
    serde_json::json!({
        "length": items.len(),
        "preview": records,
        "truncated": items.len() > shown,
    })
}
