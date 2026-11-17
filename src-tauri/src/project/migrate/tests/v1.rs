//! A comparison saved by released version 1 (0.6.x) survives the chain: v1 wrote the
//! fifteen-field matrix and the nine-field calibrated series, so the `v1 → v2` step must
//! decode the frozen v1 mirror before the later steps append M36's fields.

use super::super::v1::{SavedComparisonV1Late, StoredAnalysisResultV1};
use super::super::v3::StoredAnalysisResultV3;
use super::super::{run_with, DroppedSection, Sections, STEPS};
use super::{calibrated_v3, matrix_v3, sections_at};
use crate::audio::analysis::fixtures;
use crate::audio::analysis::{AnalysisResult, CalibratedSeriesResult};
use crate::audio::analyzers::AnalyzerId;
use crate::project::test_support::snapshot;
use crate::project::VERSION;

/// Version 1's bytes are version 3's with its two appended fields removed: each is `None`,
/// one `0x00`, so the frozen v1 mirror must read exactly that prefix.
fn as_v1(result: StoredAnalysisResultV3) -> StoredAnalysisResultV1 {
    let mut bytes = postcard::to_stdvec(&result).expect("encode");
    assert_eq!(
        bytes.pop(),
        Some(0),
        "the fixture's last appended field is None"
    );
    assert_eq!(
        bytes.pop(),
        Some(0),
        "the fixture's first appended field is None"
    );
    postcard::from_bytes(&bytes).expect("decode as version 1")
}

/// A late-v1 snapshot (the layout 0.6.x released) holding version 1's result arity.
fn v1_snapshot(tool: AnalyzerId, result: StoredAnalysisResultV1) -> SavedComparisonV1Late {
    let saved = snapshot(tool, AnalysisResult::Spectrum(fixtures::spectrum()));
    (
        tool,
        saved.reference_name,
        saved.source,
        saved.window,
        saved.params,
        saved.options,
        saved.filter_fingerprint,
        saved.b_offset,
        saved.saved_ms,
        result,
        Some("/tmp/reference.heyl".to_string()),
    )
}

#[test]
fn a_v1_comparison_survives_the_chain() {
    let matrix = fixtures::matrix();
    let calibrated = CalibratedSeriesResult {
        contribution: None,
        rate_contribution: None,
        ..fixtures::calibrated_series()
    };
    let mut sections = sections_at(1);
    sections.compare = Some(
        Sections::encode(&vec![
            v1_snapshot(
                AnalyzerId::MelSpectrogram,
                as_v1(StoredAnalysisResultV3::MelSpectrogram(matrix_v3(&matrix))),
            ),
            v1_snapshot(
                AnalyzerId::Sharpness,
                as_v1(StoredAnalysisResultV3::Sharpness(calibrated_v3(
                    &calibrated,
                ))),
            ),
        ])
        .expect("compare"),
    );

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.upgraded_from, Some(1));
    assert_eq!(loaded.dropped, vec![DroppedSection::Results]);
    assert_eq!(loaded.compare.len(), 2, "no comparison is dropped");
    assert_eq!(
        loaded.compare[0].reference_path.as_deref(),
        Some("/tmp/reference.heyl")
    );
    match loaded.compare[0].analysis_result() {
        AnalysisResult::MelSpectrogram(back) => {
            assert_eq!(back.values, matrix.values);
            assert_eq!(back.model, None);
            assert_eq!(back.normalized, None);
            assert_eq!(back.band_labels, None);
        }
        other => panic!("unexpected stored result: {other:?}"),
    }
    match loaded.compare[1].analysis_result() {
        AnalysisResult::Sharpness(back) => {
            assert_eq!(back.values, calibrated.values);
            assert!(back.contribution.is_none());
            assert!(back.rate_contribution.is_none());
            assert_eq!(back.gate, None);
        }
        other => panic!("unexpected stored result: {other:?}"),
    }
}
