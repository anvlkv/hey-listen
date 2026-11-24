//! `SourceStorage` persistence: an embedded save writes `DATA`, a linked one keeps only
//! the path, and `relativePath` lets a moved project folder resolve its audio again.

use std::io::Cursor;
use std::path::PathBuf;

use super::*;
use crate::state::SourceData;

fn pcm() -> SourceData {
    SourceData {
        samples: vec![0.0, 0.5, -0.5],
        sample_rate: 48_000,
        channels: 1,
    }
}

fn save<'a>(source: SourceDescriptor, pcm: Option<&'a SourceData>) -> SaveProject<'a> {
    SaveProject {
        name: "storage".to_string(),
        created_ms: None,
        source: Some(source),
        setup: AnalysisSetup::default(),
        layout: serde_json::Value::Null,
        results: Vec::new(),
        annotations: Vec::new(),
        compare: Vec::new(),
        pcm,
    }
}

fn round_trip(save: &SaveProject) -> crate::project::LoadedProject {
    let mut cursor = Cursor::new(Vec::new());
    write_project(&mut cursor, save, 5).expect("write");
    read_project(&mut Cursor::new(cursor.into_inner())).expect("read")
}

/// A fresh temp directory (never shared with a concurrent test).
fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("hey_storage_{name}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the temp dir");
    dir
}

/// Write `source` beside a project in `dir`, read the file back, and return the
/// descriptor it recorded (the same path `write_project_atomic` relativises against).
fn written_beside(dir: &std::path::Path, source: SourceDescriptor) -> SourceDescriptor {
    let project = dir.join("song.heyl");
    write_project_atomic(&project, &save(source, None), 5).expect("write");
    let mut file = std::fs::File::open(&project).expect("open");
    read_project(&mut file)
        .expect("read")
        .source
        .expect("a source")
}

#[test]
fn an_embedded_source_writes_data() {
    let samples = pcm();
    let source = SourceDescriptor {
        kind: SourceKind::File,
        path: Some("/tmp/tone.wav".to_string()),
        ..Default::default()
    };
    assert_eq!(source.storage, SourceStorage::Embedded);

    let loaded = round_trip(&save(source, Some(&samples)));

    assert!(loaded.embedded);
    assert_eq!(loaded.pcm.expect("the audio").samples, samples.samples);
}

#[test]
fn a_linked_source_writes_no_data() {
    let samples = pcm();
    let source = SourceDescriptor {
        kind: SourceKind::File,
        path: Some("/tmp/tone.wav".to_string()),
        storage: SourceStorage::Linked,
        ..Default::default()
    };

    let loaded = round_trip(&save(source, Some(&samples)));

    assert!(!loaded.embedded);
    assert!(loaded.pcm.is_none());
    assert_eq!(
        loaded.source.expect("a source").storage,
        SourceStorage::Linked
    );
}

#[test]
fn a_non_file_source_is_always_embedded() {
    // A synth has no file to link, so the descriptor's mode is normalised and its audio
    // is kept even when the caller asked for a link.
    let samples = pcm();
    let source = SourceDescriptor {
        kind: SourceKind::Synth,
        storage: SourceStorage::Linked,
        ..Default::default()
    };

    let loaded = round_trip(&save(source, Some(&samples)));

    assert!(loaded.embedded);
    assert!(loaded.pcm.is_some());
    assert_eq!(
        loaded.source.expect("a source").storage,
        SourceStorage::Embedded
    );
}

#[test]
fn a_save_beside_the_project_records_a_relative_path() {
    let dir = temp_dir("relative");
    let audio = dir.join("audio").join("tone.wav");
    let source = written_beside(
        &dir,
        SourceDescriptor {
            kind: SourceKind::File,
            path: Some(audio.to_string_lossy().into_owned()),
            ..Default::default()
        },
    );

    assert_eq!(source.relative_path.as_deref(), Some("audio/tone.wav"));
    assert_eq!(source.path.as_deref(), audio.to_str());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_path_outside_the_project_dir_keeps_no_relative_path() {
    let dir = temp_dir("outside");
    let elsewhere = std::env::temp_dir()
        .join("hey_storage_elsewhere")
        .join("tone.wav");
    let source = written_beside(
        &dir,
        SourceDescriptor {
            kind: SourceKind::File,
            path: Some(elsewhere.to_string_lossy().into_owned()),
            ..Default::default()
        },
    );

    assert!(source.relative_path.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_link_prefers_the_project_relative_path() {
    let dir = temp_dir("resolve-relative");
    let recordings = dir.join("recordings");
    std::fs::create_dir_all(&recordings).expect("create");
    let file = recordings.join("tone.wav");
    std::fs::write(&file, b"wave").expect("write the file");
    let source = SourceDescriptor {
        kind: SourceKind::File,
        // The recorded absolute path no longer exists: the relative one wins.
        path: Some("/nonexistent/original.wav".to_string()),
        relative_path: Some("recordings/tone.wav".to_string()),
        ..Default::default()
    };

    assert_eq!(resolve_link(&source, Some(dir.as_path())), Some(file));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_link_falls_back_to_the_recorded_path() {
    let dir = temp_dir("resolve-absolute");
    let file = dir.join("tone.wav");
    std::fs::write(&file, b"wave").expect("write the file");
    let source = SourceDescriptor {
        kind: SourceKind::File,
        path: Some(file.to_string_lossy().into_owned()),
        relative_path: Some("gone.wav".to_string()),
        ..Default::default()
    };

    assert_eq!(
        resolve_link(&source, Some(dir.as_path())),
        Some(file.clone())
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_link_is_none_for_a_missing_file_and_a_non_file_source() {
    let missing = SourceDescriptor {
        kind: SourceKind::File,
        path: Some("/nonexistent/hey-listen.wav".to_string()),
        ..Default::default()
    };
    assert!(resolve_link(&missing, None).is_none());

    let synth = SourceDescriptor {
        kind: SourceKind::Synth,
        path: Some("/nonexistent/hey-listen.wav".to_string()),
        ..Default::default()
    };
    assert!(resolve_link(&synth, None).is_none());
}

#[test]
fn the_storage_id_keeps_the_postcard_string_encoding() {
    use strum::IntoEnumIterator;
    for storage in SourceStorage::iter() {
        assert_eq!(
            postcard::to_allocvec(&storage).unwrap(),
            postcard::to_allocvec(&storage.to_string()).unwrap(),
            "{storage}"
        );
    }
}

#[test]
fn a_relative_path_without_a_project_dir_is_not_recorded() {
    let mut source = SourceDescriptor {
        kind: SourceKind::File,
        path: Some("/tmp/tone.wav".to_string()),
        relative_path: Some("stale.wav".to_string()),
        ..Default::default()
    };
    super::relativize(&mut source, None);
    assert!(source.relative_path.is_none());
}
