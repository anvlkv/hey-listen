//! Project-file read/write tests (split out of `mod.rs` for the source-size budget).

use std::collections::BTreeMap;
use std::io::Cursor;

use super::sections::{AnalysisWindow, NoteValues, StoredResult};
use super::*;
use crate::audio::analysis::compare::{SavedComparison, SourceShape, Span};
use crate::audio::analysis::{SharedParams, SpectrogramResult, StoredAnalysisResult, ToolOptions};
use crate::audio::analyzers::{AnalyzerId, ToolId};
use crate::state::SourcePcm;

fn setup() -> AnalysisSetup {
    AnalysisSetup {
        shared: Default::default(),
        tool_options: BTreeMap::from([(
            AnalyzerId::Mfcc,
            BTreeMap::from([("nMfcc".to_string(), 20.0)]),
        )]),
        open_tools: vec![ToolId::Spectrum, ToolId::Filter],
        window: AnalysisWindow {
            start_secs: 0.25,
            end_secs: 1.5,
        },
        view: AnalysisWindow {
            start_secs: 0.0,
            end_secs: 2.0,
        },
        filter_enabled: true,
    }
}

fn pcm(samples: usize) -> SourcePcm {
    let values: Vec<f32> = (0..samples).map(|i| (i as f32 * 0.001).sin()).collect();
    SourcePcm {
        samples: values,
        sample_rate: 48_000,
        channels: 2,
    }
}

fn note() -> Note {
    Note {
        id: "n1".to_string(),
        created_ms: 10,
        updated_ms: 20,
        time_secs: 2.34,
        range: None,
        tool: Some(AnalyzerId::Spectrum),
        title: Some("Third harmonic".to_string()),
        body: "Peak at **880 Hz**".to_string(),
        values: Some(NoteValues {
            tool: AnalyzerId::Spectrum,
            label: "Spectrum @ 2.34 s".to_string(),
            text: "peak 880.0 Hz, −12.4 dBFS".to_string(),
            window: AnalysisWindow {
                start_secs: 0.0,
                end_secs: 4.0,
            },
            params: Default::default(),
            options: BTreeMap::from([("showMean".to_string(), 1.0)]),
            captured_ms: 11,
        }),
    }
}

fn range_note() -> Note {
    Note {
        id: "n2".to_string(),
        created_ms: 30,
        updated_ms: 30,
        time_secs: 2.34,
        range: Some(AnalysisWindow {
            start_secs: 2.34,
            end_secs: 3.10,
        }),
        tool: None,
        title: None,
        body: "from here to here".to_string(),
        values: None,
    }
}

fn write(save: &SaveProject, now_ms: u64) -> Cursor<Vec<u8>> {
    let mut cursor = Cursor::new(Vec::new());
    write_project(&mut cursor, save, now_ms).expect("write");
    cursor
}

/// A saved comparison with a small spectrogram snapshot (M25.C).
fn saved_comparison() -> SavedComparison {
    SavedComparison {
        tool: AnalyzerId::Spectrogram,
        reference_name: "Reference project".to_string(),
        source: SourceShape {
            sample_rate: 48_000,
            channels: 1,
            duration: 2.0,
        },
        window: Span {
            start: 0.5,
            end: 1.5,
        },
        params: SharedParams {
            fft_size: 2048,
            hop: 0.5,
            ..Default::default()
        },
        options: ToolOptions {
            n_mels: Some(64),
            ..Default::default()
        },
        filter_fingerprint: Some("{\"nodes\":[]}".to_string()),
        b_offset: 0.012,
        saved_ms: 1_234,
        result: StoredAnalysisResult::Spectrogram(SpectrogramResult {
            sample_rate: 48_000,
            fft_size: 2048,
            hop_size: 1_024,
            duration: 1.0,
            window_start: 0.5,
            frames: 2,
            bins: 3,
            freqs: vec![100.0, 200.0, 300.0],
            mag_db: vec![-10.0, -20.0, -30.0, -11.0, -21.0, -31.0],
            min_db: -31.0,
            max_db: -10.0,
        }),
    }
}

#[test]
fn round_trips_every_section() {
    let pcm = pcm(5_000);
    let save = SaveProject {
        name: "Test project".to_string(),
        created_ms: Some(1_000),
        source: Some(SourceDescriptor {
            kind: SourceKind::File,
            path: Some("/tmp/tone.wav".to_string()),
            ..Default::default()
        }),
        setup: setup(),
        layout: serde_json::json!({ "dockview": { "grid": {} }, "graphs": {} }),
        results: vec![StoredResult {
            tool: AnalyzerId::Spectrum,
            start: 0.0,
            end: 1.0,
            params: Default::default(),
            options: BTreeMap::new(),
            result: vec![1, 2, 3],
        }],
        notes: vec![note(), range_note()],
        compare: vec![saved_comparison()],
        pcm: Some(&pcm),
    };

    let bytes = write(&save, 2_000).into_inner();
    let loaded = read_project(&mut Cursor::new(bytes)).expect("read");

    assert_eq!(loaded.meta.name, "Test project");
    assert_eq!(loaded.meta.created_ms, 1_000);
    assert_eq!(loaded.meta.modified_ms, 2_000);
    assert_eq!(
        loaded.setup.open_tools,
        vec![ToolId::Spectrum, ToolId::Filter]
    );
    assert!(loaded.setup.filter_enabled);
    assert_eq!(loaded.layout["dockview"]["grid"], serde_json::json!({}));
    assert_eq!(loaded.results.len(), 1);
    assert_eq!(loaded.results[0].result, vec![1, 2, 3]);
    assert_eq!(loaded.meta.app_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(loaded.source.expect("source").kind, SourceKind::File);

    // The `NOTES` section round-trips (a point note with values, a range note).
    assert_eq!(loaded.notes.len(), 2);
    let point = &loaded.notes[0];
    assert_eq!(point.id, "n1");
    assert_eq!(point.time_secs, 2.34);
    assert!(point.range.is_none());
    assert_eq!(point.tool, Some(AnalyzerId::Spectrum));
    let values = point.values.as_ref().expect("values");
    assert_eq!(values.tool, AnalyzerId::Spectrum);
    assert_eq!(values.text, "peak 880.0 Hz, −12.4 dBFS");
    assert_eq!(values.options.get("showMean"), Some(&1.0));
    let range = loaded.notes[1].range.expect("range");
    assert_eq!(range.start_secs, 2.34);
    assert_eq!(range.end_secs, 3.10);

    // The `COMPARE` section round-trips a full reference result (M25.C).
    assert_eq!(loaded.compare.len(), 1);
    let saved = &loaded.compare[0];
    assert_eq!(saved.tool, AnalyzerId::Spectrogram);
    assert_eq!(saved.reference_name, "Reference project");
    assert_eq!(saved.b_offset, 0.012);
    assert_eq!(saved.window.start, 0.5);
    assert_eq!(saved.options.n_mels, Some(64));
    assert_eq!(saved.filter_fingerprint.as_deref(), Some("{\"nodes\":[]}"));
    match saved.analysis_result() {
        crate::audio::analysis::AnalysisResult::Spectrogram(result) => {
            assert_eq!(result.frames, 2);
            assert_eq!(result.bins, 3);
            assert_eq!(result.mag_db.len(), 6);
            assert_eq!(result.mag_db[4], -21.0);
        }
        other => panic!("unexpected stored result: {other:?}"),
    }

    let pcm = loaded.pcm.expect("pcm");
    assert_eq!(pcm.sample_rate, 48_000);
    assert_eq!(pcm.channels, 2);
    assert_eq!(pcm.samples.len(), 5_000);
    assert_eq!(pcm.samples[42], (42.0f32 * 0.001).sin());
}

#[test]
fn streams_audio_across_chunks() {
    // More than one DATA chunk, and a sample count that is not a chunk multiple.
    let count = DATA_CHUNK_SAMPLES * 2 + 7;
    let pcm = pcm(count);
    let save = SaveProject {
        name: "big".to_string(),
        created_ms: None,
        source: None,
        setup: AnalysisSetup::default(),
        layout: serde_json::Value::Null,
        results: Vec::new(),
        notes: Vec::new(),
        compare: Vec::new(),
        pcm: Some(&pcm),
    };

    let bytes = write(&save, 5).into_inner();
    let loaded = read_project(&mut Cursor::new(bytes)).expect("read");
    let loaded_pcm = loaded.pcm.expect("pcm");
    assert_eq!(loaded_pcm.samples.len(), count);
    assert_eq!(loaded_pcm.samples, pcm.samples);
}

#[test]
fn writes_a_project_without_audio() {
    let save = SaveProject {
        name: "empty".to_string(),
        created_ms: None,
        source: None,
        setup: AnalysisSetup::default(),
        layout: serde_json::Value::Null,
        results: Vec::new(),
        notes: Vec::new(),
        compare: Vec::new(),
        pcm: None,
    };

    let bytes = write(&save, 5).into_inner();
    let loaded = read_project(&mut Cursor::new(bytes)).expect("read");
    assert!(loaded.pcm.is_none());
}

#[test]
fn rejects_a_corrupt_checksum() {
    let pcm = pcm(64);
    let save = SaveProject {
        name: "test".to_string(),
        created_ms: None,
        source: None,
        setup: AnalysisSetup::default(),
        layout: serde_json::Value::Null,
        results: Vec::new(),
        notes: Vec::new(),
        compare: Vec::new(),
        pcm: Some(&pcm),
    };

    let mut bytes = write(&save, 5).into_inner();
    let mid = bytes.len() / 2;
    bytes[mid] ^= 0xFF;
    assert!(matches!(
        read_project(&mut Cursor::new(bytes)),
        Err(ProjectError::Corrupt(_))
    ));
}

#[test]
fn reference_sources_fall_back_cleanly() {
    let missing = SourceDescriptor {
        kind: SourceKind::File,
        path: Some("/nonexistent/hey-listen.wav".to_string()),
        ..Default::default()
    };
    assert!(decode_reference(Some(&missing)).is_none());
    let synth = SourceDescriptor {
        kind: SourceKind::Synth,
        ..Default::default()
    };
    assert!(decode_reference(Some(&synth)).is_none());
    assert!(decode_reference(None).is_none());
}

#[test]
fn typed_ids_keep_the_postcard_string_encoding() {
    // M15.B is type safety, not a format bump: the project file must keep the same
    // bytes. Pin the map-key, vector and enum encodings against their string forms.
    let options = BTreeMap::from([(
        AnalyzerId::Mfcc,
        BTreeMap::from([("nMfcc".to_string(), 20.0)]),
    )]);
    let string_options = BTreeMap::from([("mfcc".to_string(), options[&AnalyzerId::Mfcc].clone())]);
    assert_eq!(
        postcard::to_allocvec(&options).unwrap(),
        postcard::to_allocvec(&string_options).unwrap()
    );

    let tools = vec![ToolId::Spectrum, ToolId::Filter];
    let string_tools = vec!["spectrum".to_string(), "filter".to_string()];
    assert_eq!(
        postcard::to_allocvec(&tools).unwrap(),
        postcard::to_allocvec(&string_tools).unwrap()
    );

    use strum::IntoEnumIterator;
    for kind in SourceKind::iter() {
        assert_eq!(
            postcard::to_allocvec(&kind).unwrap(),
            postcard::to_allocvec(&kind.to_string()).unwrap(),
            "{kind}"
        );
    }
}

#[test]
fn typed_tool_options_round_trip_through_json() {
    // The IPC boundary sends the map as JSON with string keys, so an `AnalyzerId`
    // key must serialize and deserialize as `"mfcc"`, not a variant index.
    let options = BTreeMap::from([(
        AnalyzerId::Mfcc,
        BTreeMap::from([("nMfcc".to_string(), 20.0)]),
    )]);
    let json = serde_json::to_string(&options).unwrap();
    assert_eq!(json, r#"{"mfcc":{"nMfcc":20.0}}"#);
    let round_trip: BTreeMap<AnalyzerId, BTreeMap<String, f64>> =
        serde_json::from_str(&json).unwrap();
    assert_eq!(round_trip, options);
}

#[test]
fn rejects_a_foreign_file() {
    let mut bytes = b"NOPE".to_vec();
    bytes.resize(64, 0);
    assert!(matches!(
        read_project(&mut Cursor::new(bytes)),
        Err(ProjectError::BadMagic)
    ));
}
