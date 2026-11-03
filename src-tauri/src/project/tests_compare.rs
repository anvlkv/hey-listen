//! `COMPARE`-section round-trip tests (split out of `tests.rs` for the size budget).
//!
//! A result payload that skips an absent optional key on the JSON wire cannot be read
//! back from `postcard` (which is not self-describing), so a saved comparison is written
//! through the stored mirror and must decode with the optional keys both absent and
//! present. See `results::stored`.

use std::io::Cursor;

use super::*;
use crate::audio::analysis::compare::{SavedComparison, SavedComparisonV1, SourceShape, Span};
use crate::audio::analysis::{AnalysisResult, SharedParams, StoredAnalysisResult, ToolOptions};
use crate::audio::analyzers::AnalyzerId;

fn write(save: &SaveProject, now_ms: u64) -> Cursor<Vec<u8>> {
    let mut cursor = Cursor::new(Vec::new());
    write_project(&mut cursor, save, now_ms).expect("write");
    cursor
}

fn snapshot(tool: AnalyzerId, result: AnalysisResult) -> SavedComparison {
    SavedComparison {
        tool,
        reference_name: "Reference project".to_string(),
        source: SourceShape {
            sample_rate: 48_000,
            channels: 1,
            duration: 1.0,
        },
        window: Span {
            start: 0.0,
            end: 1.0,
        },
        params: SharedParams::default(),
        options: ToolOptions::default(),
        filter_fingerprint: None,
        b_offset: 0.0,
        saved_ms: 7,
        result: StoredAnalysisResult::from(&result),
        reference_path: None,
    }
}

#[test]
fn an_older_compare_payload_loads_without_a_reference_path() {
    // A 0.5.1 file stores snapshots without `referencePath`; the reader must still load
    // them (the view then reports that the reference file is unknown).
    let snapshot = snapshot(
        AnalyzerId::Spectrum,
        AnalysisResult::Spectrum(crate::audio::analysis::fixtures::spectrum()),
    );
    let old: Vec<SavedComparisonV1> = vec![(
        snapshot.tool,
        snapshot.reference_name.clone(),
        snapshot.source,
        snapshot.window,
        snapshot.params.clone(),
        snapshot.options.clone(),
        snapshot.filter_fingerprint.clone(),
        snapshot.b_offset,
        snapshot.saved_ms,
        snapshot.result.clone(),
    )];
    let bytes = postcard::to_stdvec(&old).expect("encode");

    let loaded = super::read::compare_from_bytes(&bytes).expect("decode");
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].tool, AnalyzerId::Spectrum);
    assert_eq!(loaded[0].reference_name, snapshot.reference_name);
    assert_eq!(loaded[0].b_offset, snapshot.b_offset);
    assert!(loaded[0].reference_path.is_none());
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
