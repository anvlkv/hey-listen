//! The `v5 → v6` step: `ModulationResult` gains the trailing per-note `notes` field
//! (D-18). Only `RESULTS` (a cache) is dropped; a saved comparison is converted from the
//! frozen version-5 shape so the user's pinned pair survives.

use super::{run_with, sections_at, Sections, STEPS};
use crate::audio::analysis::fixtures;
use crate::audio::analysis::{AnalysisResult, SharedParams};
use crate::audio::analyzers::AnalyzerId;
use crate::project::test_support::snapshot;
use crate::project::{
    AnalysisSetup, AnalysisWindow, Annotation, DroppedSection, SourceDescriptor, SourceKind,
    VERSION,
};
use crate::state::SourceData;

#[test]
fn a_v5_file_keeps_the_users_work_and_the_saved_comparisons() {
    let mut sections = sections_at(5);
    sections.source = Some(
        Sections::encode(&Some(SourceDescriptor {
            kind: SourceKind::File,
            path: Some("/tmp/call.wav".to_string()),
            ..SourceDescriptor::default()
        }))
        .expect("source"),
    );
    sections.setup = Some(
        Sections::encode(&AnalysisSetup {
            shared: SharedParams::default(),
            window: AnalysisWindow {
                start_secs: 1.0,
                end_secs: 2.0,
            },
            view: AnalysisWindow {
                start_secs: 0.0,
                end_secs: 3.0,
            },
            ..AnalysisSetup::default()
        })
        .expect("setup"),
    );
    sections.layout = serde_json::json!({ "grid": { "root": "a" }, "panels": { "a": {} } });
    sections.annotations = Some(
        Sections::encode(&vec![Annotation {
            id: "a".to_string(),
            time_secs: 1.5,
            body: "a call".to_string(),
            ..Annotation::default()
        }])
        .expect("annotations"),
    );
    // A saved comparison survives the hop: the step converts the version-5 result shape
    // (this payload is already current — the step's fallback branch — while `v5::tests`
    // covers the frozen version-5 layout itself).
    sections.compare = Some(
        Sections::encode(&vec![snapshot(
            AnalyzerId::Spectrum,
            AnalysisResult::Spectrum(fixtures::spectrum()),
        )])
        .expect("compare"),
    );
    sections.pcm = Some(SourceData {
        samples: vec![0.0, 0.5, -0.5],
        sample_rate: 48_000,
        channels: 1,
    });

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.upgraded_from, Some(5));
    assert_eq!(loaded.dropped, vec![DroppedSection::Results]);
    assert!(loaded.results.is_empty(), "the cache is dropped");
    assert_eq!(loaded.compare.len(), 1, "the comparison survives");

    // The user's work survives untouched.
    let source = loaded.source.as_ref().expect("a source");
    assert_eq!(source.kind, SourceKind::File);
    assert_eq!(source.path.as_deref(), Some("/tmp/call.wav"));
    let pcm = loaded.pcm.as_ref().expect("the embedded audio");
    assert_eq!(pcm.samples, vec![0.0, 0.5, -0.5]);
    assert_eq!((pcm.sample_rate, pcm.channels), (48_000, 1));
    assert_eq!(loaded.setup.window.start_secs, 1.0);
    assert_eq!(loaded.setup.window.end_secs, 2.0);
    assert_eq!(loaded.layout["grid"]["root"], "a");
    assert_eq!(loaded.annotations.len(), 1);
    assert_eq!(loaded.annotations[0].body, "a call");
}
