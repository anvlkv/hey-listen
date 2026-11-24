//! The `v7 → v8` step: a source records how it is stored, and a saved comparison records
//! the reference audio it was taken from.

use super::super::v7::{SavedComparisonV7, SourceDescriptorV7};
use super::{run_with, sections_at, Sections, STEPS};
use crate::audio::analysis::compare::{SourceShape, Span};
use crate::audio::analysis::{fixtures, SharedParams, StoredAnalysisResult, ToolOptions};
use crate::audio::analyzers::AnalyzerId;
use crate::project::{DroppedSection, SourceDescriptor, SourceKind, SourceStorage, VERSION};
use crate::state::SourceData;

/// A version-7 file source: the eight fields that existed before `storage`.
fn v7_file_source(path: Option<&str>) -> SourceDescriptorV7 {
    SourceDescriptorV7 {
        kind: SourceKind::File,
        path: path.map(str::to_string),
        device_id: None,
        mix_mic_device_id: None,
        mix_system_device_id: None,
        target_pid: None,
        gain: 1.0,
        graph: None,
    }
}

fn v7_source_payload(source: SourceDescriptorV7) -> Vec<u8> {
    Sections::encode(&Some(source)).expect("source")
}

fn pcm() -> SourceData {
    SourceData {
        samples: vec![0.0, 0.25, -0.25],
        sample_rate: 48_000,
        channels: 1,
    }
}

/// A version-7 saved comparison: the fourteen fields that existed before the reference
/// audio.
fn v7_snapshot() -> SavedComparisonV7 {
    SavedComparisonV7 {
        tool: AnalyzerId::Spectrum,
        reference_name: "ref".to_string(),
        source: SourceShape {
            sample_rate: 48_000,
            channels: 1,
            duration: 3.0,
        },
        window: Span {
            start: 1.0,
            end: 2.0,
        },
        params: SharedParams::default(),
        options: ToolOptions::default(),
        filter_fingerprint: Some("{}".to_string()),
        b_offset: 0.25,
        saved_ms: 9,
        result: StoredAnalysisResult::from(&crate::audio::analysis::AnalysisResult::Spectrum(
            fixtures::spectrum(),
        )),
        reference_path: Some("/tmp/ref.heyl".to_string()),
        id: "cmp-v7".to_string(),
        owner_window: Span {
            start: 0.0,
            end: 3.0,
        },
        owner_channel: Some(1),
    }
}

#[test]
fn a_v7_file_with_data_stays_embedded() {
    let mut sections = sections_at(7);
    sections.source = Some(v7_source_payload(v7_file_source(Some("/tmp/call.wav"))));
    sections.pcm = Some(pcm());

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.upgraded_from, Some(7));
    assert_eq!(loaded.dropped, vec![DroppedSection::Results]);
    let source = loaded.source.as_ref().expect("a source");
    assert_eq!(source.storage, SourceStorage::Embedded);
    assert!(source.relative_path.is_none());
    assert_eq!(source.path.as_deref(), Some("/tmp/call.wav"));
    let embedded = loaded.pcm.as_ref().expect("the embedded audio");
    assert_eq!(embedded.samples, vec![0.0, 0.25, -0.25]);
    assert_eq!((embedded.sample_rate, embedded.channels), (48_000, 1));
}

#[test]
fn a_v7_file_without_data_becomes_linked() {
    let mut sections = sections_at(7);
    sections.source = Some(v7_source_payload(v7_file_source(Some("/tmp/call.wav"))));

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    let source = loaded.source.as_ref().expect("a source");
    assert_eq!(source.kind, SourceKind::File);
    assert_eq!(source.storage, SourceStorage::Linked);
    assert!(source.relative_path.is_none());
    assert!(loaded.pcm.is_none());
}

#[test]
fn a_v7_synth_is_embedded() {
    let mut sections = sections_at(7);
    sections.source = Some(v7_source_payload(SourceDescriptorV7 {
        kind: SourceKind::Synth,
        ..v7_file_source(None)
    }));

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    let source = loaded.source.as_ref().expect("a source");
    assert_eq!(source.kind, SourceKind::Synth);
    assert_eq!(source.storage, SourceStorage::Embedded);
}

#[test]
fn a_v7_comparison_gains_no_reference_audio() {
    let mut sections = sections_at(7);
    sections.compare = Some(Sections::encode(&vec![v7_snapshot()]).expect("compare"));

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.compare.len(), 1);
    let saved = &loaded.compare[0];
    assert!(saved.fragment.is_none());
    assert!(saved.source_path.is_none());
    assert_eq!(saved.id, "cmp-v7");
    assert_eq!(saved.reference_path.as_deref(), Some("/tmp/ref.heyl"));
    assert_eq!(saved.b_offset, 0.25);
    assert_eq!(saved.filter_fingerprint.as_deref(), Some("{}"));
    assert_eq!(saved.owner_channel, Some(1));
    assert_eq!(saved.owner_window.end, 3.0);
}

#[test]
fn a_current_payload_under_a_v7_header_still_decodes() {
    let current_source = SourceDescriptor {
        kind: SourceKind::File,
        path: Some("/tmp/call.wav".to_string()),
        storage: SourceStorage::Linked,
        ..SourceDescriptor::default()
    };
    let current_compare = crate::project::test_support::snapshot(
        AnalyzerId::Spectrum,
        crate::audio::analysis::AnalysisResult::Spectrum(fixtures::spectrum()),
    );
    let mut sections = sections_at(7);
    sections.source = Some(Sections::encode(&Some(current_source)).expect("source"));
    sections.compare = Some(Sections::encode(&vec![current_compare.clone()]).expect("compare"));

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    let source = loaded.source.as_ref().expect("a source");
    assert_eq!(source.storage, SourceStorage::Linked);
    assert_eq!(loaded.compare.len(), 1);
    assert_eq!(loaded.compare[0].id, current_compare.id);
    assert!(loaded.compare[0].fragment.is_none());
    assert!(loaded.setup.open_tools.is_empty());
}
