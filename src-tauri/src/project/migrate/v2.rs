//! Version 2 → 3: a saved comparison gains a pair id and the pinned owner side.
//!
//! Version 2 stored one reference snapshot per tool. Version 3 lets several comparisons
//! share a tool (one per compare tab), so each entry carries a stable `id` plus the
//! owner's window and channel at save time. The conversion **keeps** every snapshot: the
//! old fields become the reference side, and the owner side defaults to what version 2
//! can infer — its window is the snapshot's own window and its channel unknown (`None`),
//! which is what a result-only reload reports until the view re-links the reference.
//!
//! `SavedComparisonV2` is a **release snapshot**: never edit it.

use crate::audio::analysis::compare::{SavedComparison, SourceShape, Span};
use crate::audio::analysis::{SharedParams, StoredAnalysisResult, ToolOptions};
use crate::audio::analyzers::AnalyzerId;
use crate::project::ProjectError;

use super::Sections;

/// The `COMPARE` payload version 2 writes, in field order (a strict prefix of the
/// version-3 struct, so `postcard` decodes the older file positionally).
pub(super) type SavedComparisonV2 = (
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
    Option<String>,
);

impl From<SavedComparisonV2> for SavedComparison {
    fn from(old: SavedComparisonV2) -> Self {
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
            reference_path,
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
            reference_path,
            id: SavedComparison::new_id(saved_ms),
            // Version 2 kept no owner window: the owner ran on the same window it shows,
            // so its snapshot window is the best available default.
            owner_window: window,
            owner_channel: None,
        }
    }
}

/// Rewrite a version-2 `COMPARE` payload in the version-3 layout.
pub(super) fn from_v2_to_v3(sections: &mut Sections) -> Result<(), ProjectError> {
    if let Some(bytes) = sections.compare.as_deref() {
        sections.replace_compare(
            snapshots(bytes),
            "dropping the saved comparisons (a version 2 payload cannot be read)",
        )?;
    }
    sections.version += 1;
    Ok(())
}

/// Decode a version-2 payload, or a version-3 one written under a version-2 header.
fn snapshots(bytes: &[u8]) -> Option<Vec<SavedComparison>> {
    if let Some(old) = Sections::decode_exact::<Vec<SavedComparisonV2>>(bytes) {
        return Some(old.into_iter().map(SavedComparison::from).collect());
    }
    Sections::decode_exact::<Vec<SavedComparison>>(bytes)
}
