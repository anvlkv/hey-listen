//! Test-only project fixtures shared by the loader/writer test modules.

use crate::audio::analysis::compare::{SavedComparison, SourceShape, Span};
use crate::audio::analysis::{AnalysisResult, SharedParams, StoredAnalysisResult, ToolOptions};
use crate::audio::analyzers::AnalyzerId;

use super::{AnalysisSetup, SaveProject};
use crate::state::SourceData;

/// A minimal save payload; `pcm` is the only part the write/read tests vary.
pub(super) fn save_with<'a>(name: &str, pcm: Option<&'a SourceData>) -> SaveProject<'a> {
    SaveProject {
        name: name.to_string(),
        created_ms: None,
        source: None,
        setup: AnalysisSetup::default(),
        layout: serde_json::Value::Null,
        results: Vec::new(),
        annotations: Vec::new(),
        compare: Vec::new(),
        pcm,
    }
}

/// A saved comparison holding `result` as `tool`'s snapshot.
pub(super) fn snapshot(tool: AnalyzerId, result: AnalysisResult) -> SavedComparison {
    SavedComparison {
        tool,
        reference_name: "Reference project".to_string(),
        source: SourceShape {
            sample_rate: 48_000,
            channels: 1,
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
        saved_ms: 7,
        result: StoredAnalysisResult::from(&result),
        reference_path: None,
    }
}
