//! `COMPARE`-section round-trip tests (split out of `tests.rs` for the size budget).
//!
//! A result payload that skips an absent optional key on the JSON wire cannot be read
//! back from `postcard` (which is not self-describing), so a saved comparison is written
//! through the stored mirror and must decode with the optional keys both absent and
//! present. See `results::stored`. The version-1 payload layout is `migrate/v1.rs`'s
//! concern (see `migrate/tests.rs`).

use std::io::Cursor;

use super::test_support::snapshot;
use super::*;
use crate::audio::analysis::AnalysisResult;
use crate::audio::analyzers::AnalyzerId;

fn write(save: &SaveProject, now_ms: u64) -> Cursor<Vec<u8>> {
    let mut cursor = Cursor::new(Vec::new());
    write_project(&mut cursor, save, now_ms).expect("write");
    cursor
}

#[test]
fn round_trips_matrix_and_calibrated_series_comparisons() {
    // `bandLabels` and `gate` are the fields the stored mirror appends, and the result is
    // nested inside the snapshot, so this pins the current (version 4) tuple arity.
    let matrix = crate::audio::analysis::MatrixResult {
        band_labels: Some(vec!["C".to_string(), "C#".to_string()]),
        ..crate::audio::analysis::fixtures::matrix()
    };
    let calibrated = crate::audio::analysis::CalibratedSeriesResult {
        gate: Some(crate::audio::analysis::SeriesGate {
            gate_db: 30.0,
            gate_floor_db: -90.0,
            threshold_db: -60.0,
            gated_frames: 1,
            kept_frames: 3,
        }),
        ..crate::audio::analysis::fixtures::calibrated_series()
    };
    let save = SaveProject {
        name: "nested".to_string(),
        created_ms: None,
        source: None,
        setup: AnalysisSetup::default(),
        layout: serde_json::Value::Null,
        results: Vec::new(),
        annotations: Vec::new(),
        compare: vec![
            snapshot(
                AnalyzerId::MelSpectrogram,
                AnalysisResult::MelSpectrogram(matrix.clone()),
            ),
            snapshot(
                AnalyzerId::Sharpness,
                AnalysisResult::Sharpness(calibrated.clone()),
            ),
        ],
        pcm: None,
    };

    let bytes = write(&save, 5).into_inner();
    let loaded = read_project(&mut Cursor::new(bytes)).expect("read");
    assert_eq!(loaded.compare.len(), 2);
    match loaded.compare[0].analysis_result() {
        AnalysisResult::MelSpectrogram(back) => {
            assert_eq!(back.band_labels, matrix.band_labels);
            assert_eq!(back.values, matrix.values);
        }
        other => panic!("unexpected stored result: {other:?}"),
    }
    match loaded.compare[1].analysis_result() {
        AnalysisResult::Sharpness(back) => {
            assert_eq!(back.gate, calibrated.gate);
            assert_eq!(back.values, calibrated.values);
        }
        other => panic!("unexpected stored result: {other:?}"),
    }
}

#[test]
fn round_trips_series_comparisons() {
    // `frameSize` / `gate` / `syllables` are the keys the JSON wire omits when absent.
    let plain = crate::audio::analysis::fixtures::series();
    let measured = crate::audio::analysis::fixtures::frame_rms();
    let grouped = crate::audio::analysis::fixtures::notes();
    let save = SaveProject {
        name: "series".to_string(),
        created_ms: None,
        source: None,
        setup: AnalysisSetup::default(),
        layout: serde_json::Value::Null,
        results: Vec::new(),
        annotations: Vec::new(),
        compare: vec![
            snapshot(
                AnalyzerId::SpectralCentroid,
                AnalysisResult::SpectralCentroid(plain.clone()),
            ),
            snapshot(AnalyzerId::FrameRms, AnalysisResult::FrameRms(measured)),
            snapshot(
                AnalyzerId::NoteMetrics,
                AnalysisResult::NoteMetrics(grouped),
            ),
        ],
        pcm: None,
    };

    let bytes = write(&save, 5).into_inner();
    let loaded = read_project(&mut Cursor::new(bytes)).expect("read");
    assert_eq!(loaded.compare.len(), 3);
    match loaded.compare[0].analysis_result() {
        AnalysisResult::SpectralCentroid(back) => {
            assert_eq!(back.frame_size, None);
            assert_eq!(back.gate, None);
            assert_eq!(back.times, plain.times);
            assert_eq!(back.values, plain.values);
        }
        other => panic!("unexpected stored result: {other:?}"),
    }
    match loaded.compare[1].analysis_result() {
        AnalysisResult::FrameRms(back) => {
            assert_eq!(back.frame_size, Some(480));
            assert_eq!(back.gate, None);
        }
        other => panic!("unexpected stored result: {other:?}"),
    }
    match loaded.compare[2].analysis_result() {
        AnalysisResult::NoteMetrics(back) => {
            assert_eq!(back.note_count, 1);
            assert!(back.syllables.is_none());
        }
        other => panic!("unexpected stored result: {other:?}"),
    }
}
