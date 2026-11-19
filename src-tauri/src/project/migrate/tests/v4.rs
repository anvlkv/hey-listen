//! The `v4 → v5` step: a version-4 annotation snapshot gains the trailing `summary`
//! items (D-19). The snapshot is nested inside an `Annotation` inside a `Vec`, so postcard
//! cannot default a missing field — the step must decode the frozen shape.

use std::collections::BTreeMap;

use super::super::v4::{AnnotationV4, AnnotationValuesV4};
use super::{run_with, sections_at, Sections, STEPS};
use crate::audio::analysis::SharedParams;
use crate::audio::analyzers::AnalyzerId;
use crate::project::{AnalysisWindow, VERSION};

#[test]
fn a_v4_annotation_gains_an_empty_summary() {
    let mut sections = sections_at(4);
    sections.annotations = Some(
        Sections::encode(&vec![AnnotationV4 {
            id: "a".to_string(),
            created_ms: 1,
            updated_ms: 2,
            time_secs: 2.34,
            range: None,
            tool: Some(AnalyzerId::Spectrum),
            title: None,
            body: "a call".to_string(),
            values: Some(AnnotationValuesV4 {
                tool: AnalyzerId::Spectrum,
                label: "Spectrum @ 2.34 s".to_string(),
                text: "peak 880.0 Hz".to_string(),
                window: AnalysisWindow {
                    start_secs: 0.0,
                    end_secs: 4.0,
                },
                params: SharedParams::default(),
                options: BTreeMap::new(),
                captured_ms: 11,
            }),
        }])
        .expect("annotations"),
    );

    let loaded = run_with(STEPS, VERSION, sections).expect("migrate");

    assert_eq!(loaded.upgraded_from, Some(4));
    assert_eq!(loaded.annotations.len(), 1);
    let values = loaded.annotations[0].values.as_ref().expect("values");
    assert_eq!(values.text, "peak 880.0 Hz");
    assert!(values.summary.is_empty());
}
