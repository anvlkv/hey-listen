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
