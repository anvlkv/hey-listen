//! Version 7 → 8: a source records **how** it is stored, and a comparison records the
//! reference audio it was taken from.
//!
//! The `SOURCE` descriptor gains a trailing `storage` / `relativePath` pair, so a version-7
//! payload must be read with a frozen mirror and re-encoded. Whether an old file was
//! embedded is not in the descriptor — it is the presence of `DATA`: a file source with a
//! path and no `DATA` was a reference project, so it becomes [`SourceStorage::Linked`].
//!
//! `COMPARE` gains two trailing snapshot fields (`fragment`, `sourcePath`), so it is
//! re-encoded through the frozen snapshot layout as well. `LAYOUT` is JSON and needs no
//! rewrite; `DATA`, `SETUP`, `RESULTS` and `ANNOTATIONS` pass through untouched.
//!
//! The frozen types are **release snapshots**: never edit them.

use serde::{Deserialize, Serialize};

use crate::audio::analysis::compare::{SavedComparison, SourceShape, Span};
use crate::audio::analysis::{SharedParams, StoredAnalysisResult, ToolOptions};
use crate::audio::analyzers::AnalyzerId;
use crate::audio::graph::GraphSpec;
use crate::project::sections::{SourceDescriptor, SourceKind, SourceStorage};
use crate::project::ProjectError;

use super::{frozen_saved_comparison, Sections};

/// [`SourceDescriptor`] as version 7 wrote it (everything before `storage` / `relativePath`).
#[derive(Serialize, Deserialize)]
pub(super) struct SourceDescriptorV7 {
    pub(super) kind: SourceKind,
    pub(super) path: Option<String>,
    pub(super) device_id: Option<String>,
    pub(super) mix_mic_device_id: Option<String>,
    pub(super) mix_system_device_id: Option<String>,
    pub(super) target_pid: Option<u32>,
    pub(super) gain: f32,
    pub(super) graph: Option<GraphSpec>,
}

impl SourceDescriptorV7 {
    /// Whether this source was a reference project: a file with a path and no `DATA`.
    fn storage(&self, embedded: bool) -> SourceStorage {
        if self.kind == SourceKind::File && self.path.is_some() && !embedded {
            SourceStorage::Linked
        } else {
            SourceStorage::Embedded
        }
    }
}

impl From<SourceDescriptorV7> for SourceDescriptor {
    fn from(old: SourceDescriptorV7) -> Self {
        Self {
            kind: old.kind,
            path: old.path,
            device_id: old.device_id,
            mix_mic_device_id: old.mix_mic_device_id,
            mix_system_device_id: old.mix_system_device_id,
            target_pid: old.target_pid,
            gain: old.gain,
            graph: old.graph,
            // A version-7 save had no notion of the mode; the caller infers it from `DATA`.
            storage: SourceStorage::Embedded,
            relative_path: None,
        }
    }
}

/// [`SavedComparison`] as version 7 wrote it (everything before `fragment` / `sourcePath`).
#[derive(Serialize, Deserialize)]
pub(super) struct SavedComparisonV7 {
    pub tool: AnalyzerId,
    pub reference_name: String,
    pub source: SourceShape,
    pub window: Span,
    pub params: SharedParams,
    pub options: ToolOptions,
    pub filter_fingerprint: Option<String>,
    pub b_offset: f64,
    pub saved_ms: u64,
    pub result: StoredAnalysisResult,
    pub reference_path: Option<String>,
    pub id: String,
    pub owner_window: Span,
    pub owner_channel: Option<usize>,
}

frozen_saved_comparison!(SavedComparisonV7);

pub(super) fn from_v7_to_v8(sections: &mut Sections) -> Result<(), ProjectError> {
    let embedded = sections.pcm.is_some();
    if let Some(bytes) = sections.source.as_deref() {
        // `postcard` ignores a trailing remainder, so a current payload under a v7 header
        // decodes as the frozen mirror too; the mode is still inferred from `DATA`.
        let migrated = Sections::decode::<Option<SourceDescriptorV7>>(bytes)?.map(|old| {
            let storage = old.storage(embedded);
            SourceDescriptor {
                storage,
                ..SourceDescriptor::from(old)
            }
        });
        sections.source = Some(Sections::encode(&migrated)?);
    }
    if let Some(bytes) = sections.compare.as_deref() {
        let snapshots = Sections::decode_exact::<Vec<SavedComparisonV7>>(bytes)
            .map(|old| {
                old.into_iter()
                    .map(SavedComparison::from)
                    .collect::<Vec<_>>()
            })
            .or_else(|| Sections::decode_exact::<Vec<SavedComparison>>(bytes));
        sections.replace_compare(
            snapshots,
            "dropping the saved comparisons (no known version 7 layout)",
        )?;
    }
    sections.version += 1;
    Ok(())
}
