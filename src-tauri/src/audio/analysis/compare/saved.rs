//! The **saved reference side** of a comparison (M25.C).
//!
//! `COMPARE` (project section `0x08`) stores one snapshot per comparison that is open
//! at save time: the reference's last analysis window — its setup, effective options,
//! filter fingerprint and **full result** — plus the fine-tune offset. No reference
//! audio is embedded, so the owner project stays self-contained for its last
//! comparison. See `docs/comparison.md` and ADR-27.
//!
//! A snapshot is also the core's in-memory record of the **last successful**
//! comparison (kept per tool), which is what makes "the reference closed" keep its
//! result and what a reopened project restores.

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
    /// The analyzer id (one saved comparison per tool).
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
}

/// A compact view of a saved comparison for the frontend / MCP (no result payload).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavedComparisonInfo {
    pub tool: AnalyzerId,
    pub reference_name: String,
    pub source: SourceShape,
    pub window: Span,
    pub b_offset: f64,
    pub saved_ms: u64,
    /// A content fingerprint (see [`SavedComparison::fingerprint`]); the frontend uses
    /// it in the project's dirty signature.
    pub fingerprint: String,
}

impl SavedComparison {
    /// Capture the reference side of a **live** comparison.
    ///
    /// `reference_path` is the reference project's file, when it has one (the app reads
    /// it from the peer's project state; the CLI and a headless session pass the file
    /// they loaded). It is stored absolute, so it still opens from another working
    /// directory.
    pub fn from_side(
        tool: AnalyzerId,
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
        }
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
            tool: self.tool,
            reference_name: self.reference_name.clone(),
            source: self.source,
            window: self.window,
            b_offset: self.b_offset,
            saved_ms: self.saved_ms,
            fingerprint: self.fingerprint(),
        }
    }

    /// A stable content fingerprint (FNV-1a over the `postcard` encoding), excluding
    /// `saved_ms` so re-saving an unchanged comparison does not read as an edit.
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

/// The `COMPARE` payload written before `referencePath` existed (0.5.1 files).
///
/// `postcard` is positional, so the old struct decodes as a tuple in field order; the
/// conversion stores `None` for the path, so an existing project still loads (the view
/// then reports that the reference file is unknown instead of guessing one).
pub(crate) type SavedComparisonV1 = (
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

/// FNV-1a (64-bit) over the bytes, for a cheap, stable content fingerprint.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for &byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}
