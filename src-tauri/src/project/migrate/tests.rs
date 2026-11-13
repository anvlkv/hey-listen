//! The migration chain (M37, M23 Phase 3): the v1 → v2 and v2 → v3 steps, plus the
//! machinery around them.
//!
//! The steps are the real ones (`v1::from_v1_to_v2` and `v2::from_v2_to_v3`, registered
//! in `STEPS`); the guards (coverage, ordering, a missing/late step, a newer file) are
//! exercised with the same `apply` / `run_with` the reader uses.

use std::collections::BTreeMap;

use super::v1::SavedComparisonV1;
use super::v2::SavedComparisonV2;
use super::*;
use crate::audio::analysis::fixtures;
use crate::audio::analysis::{AnalysisResult, SharedParams};
use crate::audio::analyzers::AnalyzerId;
use crate::project::test_support::snapshot;
use crate::project::{Meta, ProjectError, MIN_READ_VERSION, VERSION};

/// A project as the reader would hand it over: `META` plus one cached result.
fn sections_at(version: u32) -> Sections {
    let meta = Meta {
        name: "Song".to_string(),
        created_ms: 1,
        modified_ms: 2,
        app_version: "0.0.0".to_string(),
        format_version: version,
    };
    let result = StoredResult {
        tool: AnalyzerId::Spectrum,
        start: 0.0,
        end: 1.0,
        params: SharedParams::default(),
        options: BTreeMap::new(),
        result: vec![1, 2, 3],
    };
    Sections {
        version,
        meta: Some(Sections::encode(&meta).expect("meta")),
        results: Some(Sections::encode(&vec![result]).expect("results")),
        ..Sections::default()
    }
}

/// The early-version-1 snapshot layout: the same fields, without `referencePath`.
fn early_v1_snapshot() -> SavedComparisonV1 {
    let saved = snapshot(
        AnalyzerId::Spectrum,
        AnalysisResult::Spectrum(fixtures::spectrum()),
    );
    (
        saved.tool,
        saved.reference_name,
        saved.source,
        saved.window,
        saved.params,
        saved.options,
        saved.filter_fingerprint,
        saved.b_offset,
        saved.saved_ms,
        saved.result,
    )
}

/// The version-2 snapshot layout: a strict prefix of today's struct, with `referencePath`.
fn v2_snapshot(reference_path: Option<String>) -> SavedComparisonV2 {
    let saved = snapshot(
        AnalyzerId::Spectrum,
        AnalysisResult::Spectrum(fixtures::spectrum()),
    );
    (
        saved.tool,
        saved.reference_name,
        saved.source,
        saved.window,
        saved.params,
        saved.options,
        saved.filter_fingerprint,
        saved.b_offset,
        saved.saved_ms,
        saved.result,
        reference_path,
    )
}

/// A broken step that forgets to advance the version.
fn stuck(_: &mut Sections) -> Result<(), ProjectError> {
    Ok(())
}

#[test]
fn the_step_table_covers_every_hop() {
    let expected = VERSION.saturating_sub(MIN_READ_VERSION);
    assert_eq!(
        STEPS.len() as u32,
        expected,
        "one step per bump in MIN_READ_VERSION..VERSION — add `migrate::vN::from_vN_to_vNp1` to STEPS"
    );
    let mut from = MIN_READ_VERSION;
    while from < VERSION {
        assert!(
            STEPS.iter().any(|step| step.from == from),
            "no migration step from version {from} — add it to STEPS and record it in \
             docs/project-file-format.md → Format version history"
        );
        from += 1;
    }
    assert!(
        STEPS.windows(2).all(|pair| pair[0].from < pair[1].from),
        "the steps are ordered by version"
    );
}

#[test]
fn an_early_v1_compare_snapshot_gains_a_reference_path() {
    let mut sections = sections_at(1);
    sections.compare = Some(Sections::encode(&vec![early_v1_snapshot()]).expect("compare"));

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.upgraded_from, Some(1));
    assert_eq!(loaded.compare.len(), 1);
    assert_eq!(loaded.compare[0].tool, AnalyzerId::Spectrum);
    assert_eq!(loaded.compare[0].reference_path, None);
    assert!(!loaded.compare[0].id.is_empty(), "the pair id is assigned");
    assert_eq!(loaded.dropped, vec![DroppedSection::Results]);
}

#[test]
fn a_late_v1_compare_snapshot_keeps_its_reference_path() {
    // Version 1 shipped both layouts: a build after `referencePath` landed wrote the
    // version-2 tuple under the same version.
    let mut sections = sections_at(1);
    sections.compare = Some(
        Sections::encode(&vec![v2_snapshot(Some("/tmp/reference.heyl".to_string()))])
            .expect("compare"),
    );

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.compare.len(), 1);
    assert_eq!(
        loaded.compare[0].reference_path.as_deref(),
        Some("/tmp/reference.heyl")
    );
}

#[test]
fn a_v2_compare_snapshot_gains_an_id_and_a_pinned_owner_side() {
    let mut sections = sections_at(2);
    sections.compare = Some(
        Sections::encode(&vec![v2_snapshot(Some("/tmp/reference.heyl".to_string()))])
            .expect("compare"),
    );

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.upgraded_from, Some(2));
    assert_eq!(loaded.dropped, vec![DroppedSection::Results]);
    assert_eq!(loaded.compare.len(), 1);
    let saved = &loaded.compare[0];
    assert_eq!(saved.tool, AnalyzerId::Spectrum);
    assert_eq!(saved.reference_name, "Reference project");
    assert_eq!(saved.saved_ms, 7);
    assert_eq!(saved.reference_path.as_deref(), Some("/tmp/reference.heyl"));
    assert!(saved.id.starts_with("cmp-"), "{}", saved.id);
    // Version 2 kept no owner side: the snapshot window is the best default.
    assert_eq!(saved.owner_window.start, saved.window.start);
    assert_eq!(saved.owner_window.end, saved.window.end);
    assert_eq!(saved.owner_channel, None);
}

#[test]
fn an_unreadable_compare_section_is_dropped() {
    let mut sections = sections_at(1);
    sections.compare = Some(vec![0xff; 8]);

    let loaded = run_with(STEPS, VERSION, sections).expect("the upgrade still succeeds");

    assert!(loaded.compare.is_empty());
    assert!(loaded.dropped.contains(&DroppedSection::SavedComparisons));
}

#[test]
fn a_current_file_keeps_its_results_and_is_not_an_upgrade() {
    let loaded = run_with(STEPS, VERSION, sections_at(VERSION)).expect("read");

    assert_eq!(loaded.meta.name, "Song");
    assert_eq!(loaded.format_version, VERSION);
    assert_eq!(loaded.upgraded_from, None);
    assert!(loaded.dropped.is_empty());
    assert_eq!(loaded.results.len(), 1, "a current file keeps its cache");
}

#[test]
fn a_missing_step_is_refused() {
    let err = run_with(&[], VERSION + 1, sections_at(VERSION)).expect_err("no step");
    assert!(matches!(
        err,
        ProjectError::MissingMigrationStep(v) if v == VERSION
    ));
}

#[test]
fn a_step_must_advance_exactly_one_version() {
    let step = Step {
        from: VERSION,
        apply: stuck,
    };
    let err =
        run_with(&[step], VERSION + 1, sections_at(VERSION)).expect_err("the step did not advance");
    assert!(matches!(err, ProjectError::Corrupt(_)));
}

#[test]
fn a_newer_version_is_refused() {
    let err = run(sections_at(VERSION + 1)).expect_err("a newer file is not readable");
    assert!(matches!(err, ProjectError::UnsupportedVersion(v) if v == VERSION + 1));
}
