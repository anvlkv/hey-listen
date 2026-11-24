//! The migration chain (M37, M23 Phase 3, M36 follow-up): the v1 → v2, v2 → v3 and
//! v3 → v4 steps, plus the machinery around them.
//!
//! The steps are the real ones (`v1::from_v1_to_v2`, `v2::from_v2_to_v3` and
//! `v3::from_v3_to_v4`, registered in `STEPS`); the guards (coverage, ordering, a
//! missing/late step, a newer file) are exercised with the same `apply` / `run_with` the
//! reader uses.

use std::collections::BTreeMap;

mod v1;
mod v4;
mod v5;
mod v7;

use super::v1::{SavedComparisonV1, StoredAnalysisResultV1};
use super::v2::SavedComparisonV2;
use super::v3::{
    SavedComparisonV3, StoredAnalysisResultV3, StoredCalibratedSeriesV3, StoredMatrixV3,
};
use super::*;
use crate::audio::analysis::fixtures;
use crate::audio::analysis::{
    AnalysisResult, CalibratedSeriesResult, MatrixResult, SharedParams, StoredAnalysisResult,
    StoredCalibratedSeries, StoredMatrix,
};
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
        StoredAnalysisResultV1::Spectrum(fixtures::spectrum()),
    )
}

/// The version-2 snapshot layout: the early-v1 fields plus `referencePath`.
fn v2_snapshot(reference_path: Option<String>) -> SavedComparisonV2 {
    let (a, b, c, d, e, f, g, h, i, result) = early_v1_snapshot();
    (a, b, c, d, e, f, g, h, i, result.into(), reference_path)
}

/// The version-3 snapshot: today's fields, a result in the pre-`gate` / pre-`bandLabels`
/// shape (`postcard` tuple 17 for a matrix, 11 for a calibrated series).
fn v3_snapshot(tool: AnalyzerId, result: StoredAnalysisResultV3) -> SavedComparisonV3 {
    let saved = snapshot(
        AnalyzerId::Spectrum,
        AnalysisResult::Spectrum(fixtures::spectrum()),
    );
    SavedComparisonV3 {
        tool,
        reference_name: saved.reference_name,
        source: saved.source,
        window: saved.window,
        params: saved.params,
        options: saved.options,
        filter_fingerprint: saved.filter_fingerprint,
        b_offset: saved.b_offset,
        saved_ms: saved.saved_ms,
        result,
        reference_path: saved.reference_path,
        id: saved.id,
        owner_window: saved.owner_window,
        owner_channel: saved.owner_channel,
    }
}

fn matrix_v3(r: &MatrixResult) -> StoredMatrixV3 {
    StoredMatrixV3(
        (
            r.sample_rate,
            r.hop_size,
            r.frames,
            r.bins,
            r.duration,
            r.times.clone(),
            r.window_start,
            r.bands.clone(),
            r.values.clone(),
            r.min_value,
            r.max_value,
            r.band_edges.clone(),
            r.unit.clone(),
            r.calibrated,
            r.calibration_db_spl,
            r.model.clone(),
        ),
        r.normalized,
    )
}

fn calibrated_v3(r: &CalibratedSeriesResult) -> StoredCalibratedSeriesV3 {
    (
        r.sample_rate,
        r.hop_size,
        r.window_start,
        r.times.clone(),
        r.values.clone(),
        r.min_value,
        r.max_value,
        r.calibrated,
        r.calibration_db_spl,
        r.contribution.clone(),
        r.rate_contribution.clone(),
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
            "no migration step from version {from} — add it to STEPS"
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
fn a_v3_compare_snapshot_gains_the_new_result_fields() {
    // Version 3 stored a result without `gate` / `bandLabels`; the nested payload cannot
    // use the trailing-field tolerance (the snapshot's own fields follow it), so the step
    // decodes the frozen 17 / 11 shape and re-encodes the current one.
    let matrix = fixtures::matrix();
    let calibrated = fixtures::calibrated_series();
    let mut sections = sections_at(3);
    sections.compare = Some(
        Sections::encode(&vec![
            v3_snapshot(
                AnalyzerId::MelSpectrogram,
                StoredAnalysisResultV3::MelSpectrogram(matrix_v3(&matrix)),
            ),
            v3_snapshot(
                AnalyzerId::Sharpness,
                StoredAnalysisResultV3::Sharpness(calibrated_v3(&calibrated)),
            ),
        ])
        .expect("compare"),
    );

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.upgraded_from, Some(3));
    assert_eq!(loaded.dropped, vec![DroppedSection::Results]);
    assert_eq!(loaded.compare.len(), 2);
    match loaded.compare[0].analysis_result() {
        AnalysisResult::MelSpectrogram(back) => {
            assert_eq!(back.values, matrix.values);
            assert_eq!(back.band_labels, None);
        }
        other => panic!("unexpected stored result: {other:?}"),
    }
    match loaded.compare[1].analysis_result() {
        AnalysisResult::Sharpness(back) => {
            assert_eq!(back.values, calibrated.values);
            assert_eq!(back.gate, None);
        }
        other => panic!("unexpected stored result: {other:?}"),
    }
}

#[test]
fn a_v2_matrix_comparison_survives_the_chain() {
    // Version 2 is the last released format (0.6.2); its stored matrix used the same 17
    // fields version 3 did, so the v2 → v3 hop must read that shape, not today's 18.
    let matrix = fixtures::matrix();
    let mut snapshot = v2_snapshot(None);
    snapshot.0 = AnalyzerId::MelSpectrogram;
    snapshot.9 = StoredAnalysisResultV3::MelSpectrogram(matrix_v3(&matrix));

    let mut sections = sections_at(2);
    sections.compare = Some(Sections::encode(&vec![snapshot]).expect("compare"));

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.dropped, vec![DroppedSection::Results]);
    assert_eq!(loaded.compare.len(), 1);
    match loaded.compare[0].analysis_result() {
        AnalysisResult::MelSpectrogram(back) => assert_eq!(back.values, matrix.values),
        other => panic!("unexpected stored result: {other:?}"),
    }
}

#[test]
fn the_frozen_v3_result_is_the_pre_field_prefix_of_the_live_one() {
    // The live mirror writes the new field last (`None` = one `0x00`), so dropping that
    // byte leaves exactly the version-3 bytes. Decoding them as the frozen mirror pins the
    // two wire layouts against each other instead of trusting a field list.
    let matrix = fixtures::matrix();
    let live = StoredAnalysisResult::MelSpectrogram(StoredMatrix::from(&matrix));
    let mut bytes = postcard::to_stdvec(&live).expect("encode matrix");
    assert_eq!(bytes.pop(), Some(0), "bandLabels None is the last byte");
    let froze = postcard::from_bytes::<StoredAnalysisResultV3>(&bytes).expect("decode matrix");
    match froze {
        StoredAnalysisResultV3::MelSpectrogram(back) => {
            let back = StoredMatrix::from(back);
            assert_eq!(back.values, matrix.values);
            assert_eq!(back.band_labels, None);
        }
        _ => panic!("not a matrix"),
    }

    let series = fixtures::calibrated_series();
    let live = StoredAnalysisResult::Sharpness(StoredCalibratedSeries::from(&series));
    let mut bytes = postcard::to_stdvec(&live).expect("encode calibrated series");
    assert_eq!(bytes.pop(), Some(0), "gate None is the last byte");
    let froze = postcard::from_bytes::<StoredAnalysisResultV3>(&bytes).expect("decode series");
    match froze {
        StoredAnalysisResultV3::Sharpness(back) => {
            let back = StoredCalibratedSeries::from(back);
            assert_eq!(back.values, series.values);
            assert_eq!(back.gate, None);
        }
        _ => panic!("not a calibrated series"),
    }
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
