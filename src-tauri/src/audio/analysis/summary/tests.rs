//! Summary coverage for every result family (M21).

use super::{summarize, summary_keys};
use crate::audio::analysis::fixtures::{matrix, notes, pitch, samples, series};
use crate::audio::analysis::{
    AnalysisResult, MatrixResult, NoteMetricsResult, PitchResult, SeriesGate, SeriesResult,
    SyllableMetric,
};

/// The keys a summary can produce for `result`: the documented family keys, minus the
/// optional ones the result does not exercise (a gate or syllable grouping that is
/// off, or a median f0 the track cannot support).
fn expected_keys(result: &AnalysisResult) -> Vec<&'static str> {
    let mut skip: &[&str] = &[];
    if let Some(series) = result.series() {
        if series.gate.is_none() {
            skip = &[
                "gateDb",
                "gateFloorDb",
                "gateThresholdDb",
                "gatedFrames",
                "keptFrames",
            ];
        }
    }
    if let Some(pitch) = match result {
        AnalysisResult::PitchPyin(r)
        | AnalysisResult::PitchYin(r)
        | AnalysisResult::PitchAutocorr(r) => Some(r),
        _ => None,
    } {
        if !pitch.f0_reliable {
            skip = &["medianF0Hz", "meanF0Hz"];
        }
    }
    if let AnalysisResult::NoteMetrics(notes) = result {
        if notes.syllables.is_none() {
            skip = &["syllableCount"];
        }
    }
    summary_keys(result.tool_id())
        .iter()
        .copied()
        .filter(|key| !skip.contains(key))
        .collect()
}

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
        assert_eq!(keys, expected_keys(&result), "{tool}: summary keys drifted");
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
fn pitch_summary_reports_the_voiced_share_and_reliability() {
    let summary = summarize(&AnalysisResult::PitchYin(pitch()));
    let voiced = summary
        .items
        .iter()
        .find(|item| item.key == "voicedFraction")
        .expect("voiced fraction");
    assert_eq!(voiced.value, 75.0);
    assert_eq!(voiced.unit.as_deref(), Some("%"));
    let frames = summary
        .items
        .iter()
        .find(|item| item.key == "voicedFrames")
        .expect("voiced frames");
    assert_eq!(frames.value, 3.0);
    let reliable = summary
        .items
        .iter()
        .find(|item| item.key == "f0Reliable")
        .expect("f0 reliability");
    assert_eq!(reliable.value, 0.0);
    // Three voiced frames are not a pitch: no median is presented.
    assert!(summary.items.iter().all(|item| item.key != "medianF0Hz"));
    assert!(summary.items.iter().all(|item| item.key != "meanF0Hz"));
}

#[test]
fn a_reliable_pitch_track_reports_its_median() {
    let reliable = PitchResult {
        voiced_frames: 10,
        voiced_fraction: 0.5,
        f0_reliable: true,
        ..pitch()
    };
    let summary = summarize(&AnalysisResult::PitchYin(reliable));
    let median = summary
        .items
        .iter()
        .find(|item| item.key == "medianF0Hz")
        .expect("median f0");
    assert_eq!(median.value, 330.0);
    let reliable = summary
        .items
        .iter()
        .find(|item| item.key == "f0Reliable")
        .expect("f0 reliability");
    assert_eq!(reliable.value, 1.0);
}

#[test]
fn a_gated_series_reports_the_effective_gate() {
    let gated = SeriesResult {
        gate: Some(SeriesGate {
            gate_db: 20.0,
            gate_floor_db: -120.0,
            threshold_db: -26.0,
            gated_frames: 2,
            kept_frames: 2,
        }),
        ..series()
    };
    let summary = summarize(&AnalysisResult::SpectralCentroid(gated));
    let keys: Vec<&str> = summary.items.iter().map(|item| item.key.as_str()).collect();
    assert_eq!(keys, summary_keys("spectralCentroid"));
    let threshold = summary
        .items
        .iter()
        .find(|item| item.key == "gateThresholdDb")
        .expect("gate threshold");
    assert_eq!(threshold.value, -26.0);
    assert_eq!(threshold.unit.as_deref(), Some("dBFS"));
    let kept = summary
        .items
        .iter()
        .find(|item| item.key == "keptFrames")
        .expect("kept frames");
    assert_eq!(kept.value, 2.0);
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
fn syllable_grouping_is_summarized_when_requested() {
    let grouped = NoteMetricsResult {
        syllables: Some(vec![
            SyllableMetric {
                start_secs: 0.4,
                end_secs: 0.8,
                duration_secs: 0.4,
                note_count: 2,
                rms_db: -18.0,
                peak_db: -9.0,
            },
            SyllableMetric {
                start_secs: 0.9,
                end_secs: 1.1,
                duration_secs: 0.2,
                note_count: 1,
                rms_db: -18.0,
                peak_db: -9.0,
            },
        ]),
        ..notes()
    };
    let summary = summarize(&AnalysisResult::NoteMetrics(grouped));
    let count = summary
        .items
        .iter()
        .find(|item| item.key == "syllableCount")
        .expect("syllable count");
    assert_eq!(count.value, 2.0);
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
