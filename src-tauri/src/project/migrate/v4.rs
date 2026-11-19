//! Version 4 → 5: a frozen annotation snapshot gains trailing `summary` items (D-19).
//!
//! `AnnotationValues` gained `summary` (the tool's canonical `SummaryItem` list). `postcard`
//! is positional and the snapshot is nested inside an `Annotation` inside a `Vec`, so the
//! trailing-field tolerance cannot help: an old payload would read the next annotation's
//! fields as the summary. Version 4 wrote the pre-summary shape, so this step decodes it
//! with a frozen mirror and re-encodes the current one.
//!
//! The frozen types are **release snapshots**: never edit them.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::audio::analysis::SharedParams;
use crate::audio::analyzers::AnalyzerId;
use crate::project::sections::{AnalysisWindow, Annotation, AnnotationValues};
use crate::project::ProjectError;

use super::Sections;

/// [`AnnotationValues`] as version 4 wrote it (everything before `summary`).
#[derive(Serialize, Deserialize)]
pub(super) struct AnnotationValuesV4 {
    pub tool: AnalyzerId,
    pub label: String,
    pub text: String,
    pub window: AnalysisWindow,
    pub params: SharedParams,
    pub options: BTreeMap<String, f64>,
    pub captured_ms: u64,
}

impl From<AnnotationValuesV4> for AnnotationValues {
    fn from(old: AnnotationValuesV4) -> Self {
        Self {
            tool: old.tool,
            label: old.label,
            text: old.text,
            window: old.window,
            params: old.params,
            options: old.options,
            captured_ms: old.captured_ms,
            summary: Vec::new(),
        }
    }
}

/// [`Annotation`] as version 4 wrote it.
#[derive(Serialize, Deserialize)]
pub(super) struct AnnotationV4 {
    pub id: String,
    pub created_ms: u64,
    pub updated_ms: u64,
    pub time_secs: f64,
    pub range: Option<AnalysisWindow>,
    pub tool: Option<AnalyzerId>,
    pub title: Option<String>,
    pub body: String,
    pub values: Option<AnnotationValuesV4>,
}

impl From<AnnotationV4> for Annotation {
    fn from(old: AnnotationV4) -> Self {
        Self {
            id: old.id,
            created_ms: old.created_ms,
            updated_ms: old.updated_ms,
            time_secs: old.time_secs,
            range: old.range,
            tool: old.tool,
            title: old.title,
            body: old.body,
            values: old.values.map(AnnotationValues::from),
        }
    }
}

pub(super) fn from_v4_to_v5(sections: &mut Sections) -> Result<(), ProjectError> {
    if let Some(bytes) = sections.annotations.as_deref() {
        // A version-4 file wrote the pre-summary shape. A current payload under a v4
        // header (a re-save from a test or a pre-release build) is accepted unchanged, so
        // this step can never reject a file it has already migrated once.
        let annotations = match Sections::decode_exact::<Vec<AnnotationV4>>(bytes) {
            Some(old) => Some(old.into_iter().map(Annotation::from).collect::<Vec<_>>()),
            None => Sections::decode_exact::<Vec<Annotation>>(bytes),
        };
        if let Some(annotations) = annotations {
            sections.annotations = Some(Sections::encode(&annotations)?);
        }
    }
    sections.version += 1;
    Ok(())
}
