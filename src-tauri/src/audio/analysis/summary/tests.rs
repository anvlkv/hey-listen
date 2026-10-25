//! Summary coverage for every result family (M21).

use super::{summarize, summary_keys};
use crate::audio::analysis::fixtures::{matrix, notes, pitch, samples, series};
use crate::audio::analysis::{
    AnalysisResult, MatrixResult, NoteMetricsResult, PitchResult, SeriesResult,
};

#[test]
fn every_result_has_a_summary_with_the_documented_keys() {
    for result in samples() {
        let tool = result.tool_id();
        let summary = summarize(&result);
        assert_eq!(summary.tool, tool);
        assert!(!summary.label.is_empty(), "{tool}: empty label");
        assert!(!summary.text.is_empty(), "{tool}: empty text");
        assert!(!summary.items.is_empty(), "{tool}: no items");
        let keys: Vec<&str> = summary.items.iter().map(|item| item.key.as_str()).collect();
        assert_eq!(keys, summary_keys(tool), "{tool}: summary keys drifted");
        for item in &summary.items {
            assert!(item.value.is_finite(), "{tool}: {} is not finite", item.key);
            assert!(!item.label.is_empty(), "{tool}: {} has no label", item.key);
        }
    }
}

#[test]
fn spectrum_summary_names_the_peak_with_units() {
    let summary = summarize(&samples()[3]);
    assert_eq!(summary.items[0].key, "peakHz");
    assert_eq!(summary.items[0].unit.as_deref(), Some("Hz"));
    assert_eq!(summary.items[1].unit.as_deref(), Some("dBFS"));
    assert!(summary.text.contains("peak 200 Hz"), "{}", summary.text);
    assert!(summary.text.contains("frames 10"), "{}", summary.text);
}

#[test]
fn pitch_summary_reports_the_voiced_share() {
    let summary = summarize(&AnalysisResult::PitchYin(pitch()));
    let voiced = summary
        .items
        .iter()
        .find(|item| item.key == "voicedFraction")
        .expect("voiced fraction");
    assert_eq!(voiced.value, 75.0);
    assert_eq!(voiced.unit.as_deref(), Some("%"));
    let median = summary
        .items
        .iter()
        .find(|item| item.key == "medianF0Hz")
        .expect("median f0");
    assert_eq!(median.value, 330.0);
}

#[test]
fn note_summary_names_the_loudest_note() {
    let summary = summarize(&AnalysisResult::NoteMetrics(notes()));
    let loudest = summary
        .items
        .iter()
        .find(|item| item.key == "loudestNoteDb")
        .expect("loudest note");
    assert_eq!(loudest.value, -18.0);
    assert_eq!(loudest.unit.as_deref(), Some("dBFS"));
}

#[test]
fn empty_and_silent_results_still_summarize() {
    let empty = SeriesResult {
        frames: 0,
        times: Vec::new(),
        values: Vec::new(),
        min_value: 0.0,
        max_value: 0.0,
        ..series()
    };
    let silent_pitch = PitchResult {
        frames: 0,
        times: Vec::new(),
        values: Vec::new(),
        voiced_frames: 0,
        voiced_fraction: 0.0,
        ..pitch()
    };
    let empty_matrix = MatrixResult {
        frames: 0,
        bins: 0,
        times: Vec::new(),
        bands: Vec::new(),
        values: Vec::new(),
        ..matrix()
    };
    let empty_notes = NoteMetricsResult {
        note_count: 0,
        gap_count: 0,
        notes: Vec::new(),
        gaps: Vec::new(),
        reference_note_index: None,
        ..notes()
    };
    for result in [
        AnalysisResult::SpectralCentroid(empty.clone()),
        AnalysisResult::FrameRms(empty.clone()),
        AnalysisResult::LoudnessMomentary(empty),
        AnalysisResult::PitchYin(silent_pitch),
        AnalysisResult::Mfcc(empty_matrix),
        AnalysisResult::NoteMetrics(empty_notes),
    ] {
        let summary = summarize(&result);
        assert!(!summary.text.is_empty(), "{}", result.tool_id());
        for item in &summary.items {
            assert!(item.value.is_finite(), "{}", result.tool_id());
        }
    }
}
