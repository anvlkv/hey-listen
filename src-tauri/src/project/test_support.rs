//! Test-only project fixtures shared by the loader/writer test modules.

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
