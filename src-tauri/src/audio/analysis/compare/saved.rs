//! The **saved reference side** of a comparison (M25.C).
//!
//! `COMPARE` (project section `0x08`) stores a snapshot per comparison that is open
//! at save time: the reference's last analysis window — its setup, effective options,
//! filter fingerprint and **full result** — plus the fine-tune offset and the pinned
//! owner side. No reference audio is embedded, so the owner project stays
//! self-contained for its last comparison. See `docs/comparison.md` and ADR-27.
//!
//! A snapshot is also the core's in-memory record of the **last successful**
//! comparison of each pair, which is what makes "the reference closed" keep its
//! result and what a reopened project restores. Several snapshots can share a tool
//! (M23 Phase 3): one compare tab is one pair, identified by [`id`](Self::id).

use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::audio::analysis::{SharedParams, StoredAnalysisResult, ToolOptions};
use crate::audio::analyzers::AnalyzerId;

use super::align::Span;
use super::{CompareSetup, ComparisonSide, SourceShape};

/// One saved comparison: the reference side of a diff, frozen at save time.
///
/// The payload is `postcard`-encoded in the project file. `result` uses the
/// postcard-safe [`StoredAnalysisResult`] mirror because the IPC `AnalysisResult` is
/// internally tagged (see that type's module note).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedComparison {
    /// The analyzer id (several saved comparisons may share a tool).
    pub tool: AnalyzerId,
    /// The reference project's display name (window labels are session-scoped).
    pub reference_name: String,
    /// The reference's source shape, for the header and the analysis rate.
    pub source: SourceShape,
    /// The reference's analysis window in absolute source seconds.
    pub window: Span,
    /// The shared params the result was produced with.
    pub params: SharedParams,
    /// The reference's **effective** tool options.
    pub options: ToolOptions,
    /// A canonical JSON fingerprint of the reference's applied filter (`None` =
    /// unfiltered), so `filtersDiffer` still works after a reload.
    pub filter_fingerprint: Option<String>,
    /// The fine-tune offset δ in seconds.
    pub b_offset: f64,
    /// When the snapshot was written (Unix ms).
    pub saved_ms: u64,
    /// The reference's full result for that window.
    pub result: StoredAnalysisResult,
    /// The reference project's **file path** (M25.D), so "Open reference" can open the
    /// other project again; `None` when the reference was a project that was never
    /// saved. Appended last so an older payload is a strict prefix of this one.
    pub reference_path: Option<String>,
    /// Stable id, generated when the snapshot is taken, so several saved comparisons
    /// can share a tool (one per compare tab).
    pub id: String,
    /// The **owner's** analysis window at save time (pinned), so the pair can be
    /// restored without the owner's live window.
    pub owner_window: Span,
    /// The owner's channel at save time (pinned); `None` is the downmix.
    pub owner_channel: Option<usize>,
}

/// A compact view of a saved comparison for the frontend / MCP (no result payload).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavedComparisonInfo {
    /// The snapshot's stable id (a compare tab binds to it; several per tool).
    pub id: String,
    pub tool: AnalyzerId,
    pub reference_name: String,
    pub source: SourceShape,
    /// The reference's pinned window.
    pub window: Span,
    /// The owner's pinned window at save time.
    pub owner_window: Span,
    /// The owner's channel at save time (`null` is the downmix).
    pub owner_channel: Option<usize>,
    pub b_offset: f64,
    pub saved_ms: u64,
    /// A content fingerprint (see [`SavedComparison::fingerprint`]); the frontend uses
    /// it in the project's dirty signature.
    pub fingerprint: String,
}

impl SavedComparison {
    /// Capture the reference side of a **live** comparison.
    ///
    /// `id` is pinned by the caller (a compare tab's own id), so the live tab and its
    /// saved snapshot stay the same pair; `owner` is the owner's setup (its window and
    /// channel are pinned with the snapshot); `reference_path` is the reference project's
    /// file, when it has one (the app reads it from the peer's project state; the CLI and
    /// a headless session pass the file they loaded). It is stored absolute, so it still
    /// opens from another working directory.
    #[allow(clippy::too_many_arguments)] // the caller pins the pair and the reference's provenance
    pub fn from_side(
        tool: AnalyzerId,
        id: String,
        owner: &CompareSetup,
        side: &ComparisonSide,
        filter_fingerprint: Option<String>,
        b_offset: f64,
        saved_ms: u64,
        reference_path: Option<String>,
    ) -> Self {
        Self {
            tool,
            reference_name: side
                .project
                .clone()
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "Reference".to_string()),
            source: side.source.unwrap_or(SourceShape {
                sample_rate: 1,
                channels: 1,
                duration: 0.0,
            }),
            window: Span {
                start: side.setup.start,
                end: side.setup.end,
            },
            params: side.setup.params.clone(),
            options: side.setup.options.clone(),
            filter_fingerprint,
            b_offset,
            saved_ms,
            result: StoredAnalysisResult::from(&side.result),
            reference_path: reference_path.map(|path| {
                std::fs::canonicalize(&path)
                    .map(|resolved| resolved.to_string_lossy().into_owned())
                    .unwrap_or(path)
            }),
            id,
            owner_window: owner.span(),
            owner_channel: owner.params.channel,
        }
    }

    /// A fresh snapshot id, for a caller that has none to pin. No `uuid` dependency is
    /// needed: the save clock, the process and a per-process counter keep two saves in
    /// one millisecond — or two processes — apart.
    pub fn new_id(saved_ms: u64) -> String {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        format!(
            "cmp-{saved_ms:x}-{:x}-{:x}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
    }

    /// Whether this snapshot covers the same **pair** as `other`: one tool against one
    /// reference project. An **id-less** caller reuses the pair's existing id, so a
    /// debounced re-run updates its entry instead of appending a new one; a caller that
    /// pins an id gets its own entry (several tabs may share a pair).
    pub fn same_pair(&self, other: &Self) -> bool {
        self.tool == other.tool
            && self.reference_name == other.reference_name
            && self.reference_path == other.reference_path
    }

    /// The saved side's setup, as the comparison engine expects it.
    pub fn setup(&self) -> CompareSetup {
        CompareSetup {
            start: self.window.start,
            end: self.window.end,
            params: self.params.clone(),
            options: self.options.clone(),
        }
    }

    /// The stored result as the IPC result type (a clone; the snapshot is kept).
    pub fn analysis_result(&self) -> crate::audio::analysis::AnalysisResult {
        self.result.clone().into()
    }

    /// The compact wire form.
    pub fn info(&self) -> SavedComparisonInfo {
        SavedComparisonInfo {
            id: self.id.clone(),
            tool: self.tool,
            reference_name: self.reference_name.clone(),
            source: self.source,
            window: self.window,
            owner_window: self.owner_window,
            owner_channel: self.owner_channel,
            b_offset: self.b_offset,
            saved_ms: self.saved_ms,
            fingerprint: self.fingerprint(),
        }
    }

    /// A stable content fingerprint (FNV-1a over the `postcard` encoding), excluding
    /// `saved_ms` and the pair fields (`id`, `owner_window`, `owner_channel`) so
    /// re-saving an unchanged reference does not read as an edit.
    ///
    /// The frontend includes this in the project's dirty signature: a settled change in
    /// the live reference changes the would-be snapshot, so A prompts on close.
    pub fn fingerprint(&self) -> String {
        let key = (
            self.tool,
            &self.reference_name,
            &self.source,
            &self.window,
            &self.params,
            &self.options,
            &self.filter_fingerprint,
            self.b_offset,
            &self.result,
            &self.reference_path,
        );
        let bytes = postcard::to_stdvec(&key).unwrap_or_default();
        format!("{:016x}", fnv1a(&bytes))
    }
}

/// FNV-1a (64-bit) over the bytes, for a cheap, stable content fingerprint.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for &byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::fixtures;
    use crate::audio::analysis::AnalysisResult;

    fn snapshot(saved_ms: u64) -> SavedComparison {
        SavedComparison {
            tool: AnalyzerId::Spectrum,
            reference_name: "Reference".to_string(),
            source: SourceShape {
                sample_rate: 48_000,
                channels: 2,
                duration: 1.0,
            },
            window: Span {
                start: 0.0,
                end: 1.0,
            },
            params: SharedParams::default(),
            options: ToolOptions::default(),
            filter_fingerprint: None,
            b_offset: 0.0,
            saved_ms,
            result: StoredAnalysisResult::from(&AnalysisResult::Spectrum(fixtures::spectrum())),
            reference_path: None,
            id: SavedComparison::new_id(saved_ms),
            owner_window: Span {
                start: 0.25,
                end: 0.75,
            },
            owner_channel: Some(1),
        }
    }

    #[test]
    fn the_pair_fields_round_trip_through_postcard() {
        let saved = snapshot(11);
        let bytes = postcard::to_stdvec(&saved).expect("encode");
        let back: SavedComparison = postcard::from_bytes(&bytes).expect("decode");

        assert_eq!(back.id, saved.id);
        assert_eq!(back.owner_window.start, 0.25);
        assert_eq!(back.owner_window.end, 0.75);
        assert_eq!(back.owner_channel, Some(1));
        assert_eq!(back.reference_name, saved.reference_name);
    }

    #[test]
    fn the_fingerprint_ignores_the_pair_fields() {
        // The frontend's dirty signature tracks the reference, so a new id or a moved
        // owner window must not read as an unsaved edit.
        let saved = snapshot(11);
        let mut other = saved.clone();
        other.id = "another".to_string();
        other.owner_window = Span {
            start: 0.0,
            end: 0.5,
        };
        other.owner_channel = None;

        assert_eq!(saved.fingerprint(), other.fingerprint());
    }

    #[test]
    fn ids_are_distinct() {
        assert_ne!(SavedComparison::new_id(11), SavedComparison::new_id(11));
    }
}
