//! Version 1 → 2: the `COMPARE` snapshot gains `referencePath`.
//!
//! A saved comparison appended the reference project's path **after** its first release,
//! so version 1 shipped two payload layouts: early v1 without the field, late v1 with it.
//! Version 2 makes the field part of the snapshot, so the payload is rewritten here and
//! the current decoder no longer has to guess (it used to, at every load — see the M37
//! roadmap note and ADR-27's amendment).
//!
//! Every other section is unchanged between v1 and v2 and passes through untouched.
//!
//! `SavedComparisonV1` is a **release snapshot**: never edit it.

use crate::audio::analysis::compare::{SavedComparison, SourceShape, Span};
use crate::audio::analysis::{SharedParams, StoredAnalysisResult, ToolOptions};
use crate::audio::analyzers::AnalyzerId;
use crate::project::ProjectError;

use super::{DroppedSection, Sections};

/// The `COMPARE` payload written before `referencePath` existed.
///
/// `postcard` is positional, so the old payload decodes as a tuple in field order; the
/// conversion stores `None` for the path, so an existing project still loads (the view
/// then reports that the reference file is unknown instead of guessing one).
pub(super) type SavedComparisonV1 = (
    AnalyzerId,
    String,
    SourceShape,
    Span,
    SharedParams,
    ToolOptions,
    Option<String>,
    f64,
    u64,
    StoredAnalysisResult,
);

impl From<SavedComparisonV1> for SavedComparison {
    fn from(old: SavedComparisonV1) -> Self {
        let (
            tool,
            reference_name,
            source,
            window,
            params,
            options,
            filter_fingerprint,
            b_offset,
            saved_ms,
            result,
        ) = old;
        Self {
            tool,
            reference_name,
            source,
            window,
            params,
            options,
            filter_fingerprint,
            b_offset,
            saved_ms,
            result,
            reference_path: None,
        }
    }
}

/// Rewrite a version-1 `COMPARE` payload in the version-2 layout.
///
/// A saved comparison is analysis output, so a payload neither layout can read (a result
/// from a build whose mirror no longer matches) is **dropped with a warning**, not a load
/// failure. Its snapshots are recomputable by re-running the comparison.
pub(super) fn from_v1_to_v2(sections: &mut Sections) -> Result<(), ProjectError> {
    if let Some(bytes) = sections.compare.as_deref() {
        match snapshots(bytes) {
            Some(snapshots) => sections.compare = Some(Sections::encode(&snapshots)?),
            None => {
                eprintln!(
                    "hey-listen: dropping the saved comparisons (a version 1 payload cannot be read)"
                );
                sections.compare = None;
                sections.dropped.push(DroppedSection::SavedComparisons);
            }
        }
    }
    sections.version += 1;
    Ok(())
}

/// Decode a version-1 payload: the late-v1 layout first, then the early-v1 frozen tuple.
fn snapshots(bytes: &[u8]) -> Option<Vec<SavedComparison>> {
    if let Ok(current) = postcard::from_bytes::<Vec<SavedComparison>>(bytes) {
        return Some(current);
    }
    postcard::from_bytes::<Vec<SavedComparisonV1>>(bytes)
        .ok()
        .map(|old| old.into_iter().map(SavedComparison::from).collect())
}
