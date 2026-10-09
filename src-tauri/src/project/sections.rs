//! Typed payloads for the structured (non-`DATA`) project sections.
//!
//! `META`, `SOURCE`, `SETUP`, and `RESULTS` are `postcard`-encoded; `LAYOUT` is
//! `serde_json` (see `docs/project-file-format.md`). The Rust structs are shared
//! with the IPC boundary, so they also carry the frontend's (camelCase) key names.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::audio::analysis::SharedParams;
use crate::audio::graph::GraphSpec;

/// `META` section: the project's identity and provenance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    /// Human-readable project name (defaults to the source's name).
    pub name: String,
    /// Creation time, in Unix milliseconds.
    pub created_ms: u64,
    /// Last-save time, in Unix milliseconds.
    pub modified_ms: u64,
    /// The app version that wrote the file.
    pub app_version: String,
    /// The container/format version the file was written with.
    pub format_version: u32,
}

/// `SOURCE` section: the project's single audio source (`docs/source-model.md`).
///
/// The audio itself lives in `DATA`; the descriptor records *what* the source was,
/// so the UI can restore its picker and (for files/synths) provenance is retained.
///
/// A `kind`-tagged struct (rather than a Serde enum) keeps the payload compatible
/// with `postcard`, which cannot encode internally-tagged enums.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDescriptor {
    /// `file` | `mic` | `system` | `process` | `mix` | `synth`.
    pub kind: String,
    /// File source: the path the audio was decoded from (provenance only).
    #[serde(default)]
    pub path: Option<String>,
    /// Input sources: the selected capture device (mic / system).
    #[serde(default)]
    pub device_id: Option<String>,
    /// `mix` sources: the mic and system devices.
    #[serde(default)]
    pub mix_mic_device_id: Option<String>,
    #[serde(default)]
    pub mix_system_device_id: Option<String>,
    /// `process` sources: the captured application.
    #[serde(default)]
    pub target_pid: Option<u32>,
    /// Input sources: the live capture gain.
    #[serde(default)]
    pub gain: f32,
    /// Synth sources: the fundsp graph that was rendered.
    #[serde(default)]
    pub graph: Option<GraphSpec>,
}

/// `SETUP` section: open tools, per-tool options, shared params, and the windows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSetup {
    /// The shared analysis params (ADR-6).
    pub shared: SharedParams,
    /// Per-tool option values: tool id → param key → value.
    #[serde(default)]
    pub tool_options: BTreeMap<String, BTreeMap<String, f64>>,
    /// Open Workbench tabs, in dockview order (tool ids).
    #[serde(default)]
    pub open_tools: Vec<String>,
    /// The analysis window `start..end` (source seconds).
    pub window: AnalysisWindow,
    /// The visible timeline range (zoom/pan).
    pub view: AnalysisWindow,
    /// Whether the filter graph is applied (the Toolbar bypass toggle).
    #[serde(default = "default_true")]
    pub filter_enabled: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AnalysisSetup {
    fn default() -> Self {
        Self {
            shared: SharedParams::default(),
            tool_options: BTreeMap::new(),
            open_tools: Vec::new(),
            window: AnalysisWindow::default(),
            view: AnalysisWindow::default(),
            filter_enabled: true,
        }
    }
}

/// A `start..end` span in source seconds.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisWindow {
    pub start_secs: f64,
    pub end_secs: f64,
}

/// `RESULTS` section entry: a cached analysis result.
///
/// Result caching is not wired up yet — the frontend re-derives results from the
/// embedded audio on load — so the section is written empty. The type is defined
/// now so the format stays forward-compatible when the cache lands.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredResult {
    /// The tool id that produced the result.
    pub tool: String,
    pub start: f64,
    pub end: f64,
    /// The shared params the result was computed with (its cache key).
    pub params: SharedParams,
    /// The per-tool options the result was computed with.
    #[serde(default)]
    pub options: BTreeMap<String, f64>,
    /// The tool result, `postcard`-encoded (empty until caching lands).
    #[serde(default)]
    pub result: Vec<u8>,
}
