//! The migration chain's mechanics (M37).
//!
//! No released version is older than [`VERSION`] yet, so [`STEPS`] is empty and there is
//! no `vN` fixture to load. These tests drive [`run_with`] with a synthetic step to pin
//! the machinery — ordering, the version guard, the `RESULTS` drop, and the decode that
//! follows — plus the real table's coverage, which a bump cannot forget.

use std::collections::BTreeMap;

use super::*;
use crate::audio::analysis::SharedParams;
use crate::audio::analyzers::AnalyzerId;
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
        meta: Some(encode(&meta)),
        results: Some(encode(&vec![result])),
        ..Sections::default()
    }
}

fn encode<T: serde::Serialize>(value: &T) -> Vec<u8> {
    postcard::to_stdvec(value).expect("encode a test payload")
}

/// A stand-in for a real `from_vN_to_vNp1`: rewrites `META`, then bumps the version.
fn rename(sections: &mut Sections) -> Result<(), ProjectError> {
    let mut meta: Meta = Sections::decode(sections.meta.as_deref().expect("meta"))?;
    meta.name.push_str(" (v2)");
    sections.meta = Some(encode(&meta));
    sections.version += 1;
    Ok(())
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
fn a_step_rewrites_its_payload_and_advances_the_version() {
    let step = Step {
        from: 1,
        apply: rename,
    };
    let loaded = run_with(&[step], 2, sections_at(1)).expect("migrate");

    assert_eq!(loaded.meta.name, "Song (v2)");
    assert_eq!(loaded.format_version, 1, "the file's version is reported");
    assert_eq!(loaded.upgraded_from, Some(1));
    assert_eq!(loaded.dropped, vec![DroppedSection::Results]);
    assert!(loaded.results.is_empty(), "results are not migrated");
}

#[test]
fn a_current_file_keeps_its_results_and_is_not_an_upgrade() {
    let loaded = run_with(&[], VERSION, sections_at(VERSION)).expect("read");

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
