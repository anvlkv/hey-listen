//! Typed payloads for the structured (non-`DATA`) project sections.
//!
//! `META`, `SOURCE`, `SETUP`, and `RESULTS` are `postcard`-encoded; `LAYOUT` is
//! `serde_json` (see `docs/project-file-format.md`). The Rust structs are shared
//! with the IPC boundary, so they also carry the frontend's (camelCase) key names.

use std::collections::BTreeMap;

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};

use crate::audio::analysis::SharedParams;
use crate::audio::analyzers::{AnalyzerId, ToolId};
use crate::audio::graph::GraphSpec;

/// `META` section: the project's identity and provenance.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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

/// The kind of the project's single audio source.
///
/// Serialized as the same camelCase string the project file, IPC and exports always
/// used. The serde impls are hand-written so `postcard` keeps the string encoding (a
/// derived impl would store the variant index and change the file format).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Default,
    strum::EnumString,
    strum::Display,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::EnumIter,
    strum::VariantNames,
    ts_rs::TS,
)]
#[strum(serialize_all = "camelCase")]
#[ts(export, rename_all = "camelCase")]
pub enum SourceKind {
    /// A decoded audio file.
    #[default]
    File,
    /// The microphone.
    Mic,
    /// System-output loopback.
    System,
    /// A captured process.
    Process,
    /// Microphone + system mixed.
    Mix,
    /// A rendered synth graph.
    Synth,
}

impl Serialize for SourceKind {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let value: &'static str = self.into();
        serializer.serialize_str(value)
    }
}

impl<'de> Deserialize<'de> for SourceKind {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(|_| {
            de::Error::custom(format!(
                "unknown source kind: {value} (expected one of {})",
                <SourceKind as strum::VariantNames>::VARIANTS.join(", ")
            ))
        })
    }
}

/// `SOURCE` section: the project's single audio source (`docs/source-model.md`).
///
/// The audio itself lives in `DATA`; the descriptor records *what* the source was,
/// so the UI can restore its picker and (for files/synths) provenance is retained.
///
/// A `kind`-tagged struct (rather than a Serde enum) keeps the payload compatible
/// with `postcard`, which cannot encode internally-tagged enums.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourceDescriptor {
    pub kind: SourceKind,
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
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalysisSetup {
    /// The shared analysis params (ADR-6).
    pub shared: SharedParams,
    /// Per-tool option values: tool id → param key → value.
    #[serde(default)]
    pub tool_options: BTreeMap<AnalyzerId, BTreeMap<String, f64>>,
    /// Open Workbench tabs, in dockview order (analyzer or graph-editor ids).
    #[serde(default)]
    pub open_tools: Vec<ToolId>,
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
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalysisWindow {
    pub start_secs: f64,
    pub end_secs: f64,
}

/// `NOTES` section entry: an annotation on the project (M14).
///
/// A note anchors to an audio **time** (a point, or an optional `range` span) and,
/// optionally, to an **analyzer tool id** (absent = a Timeline note). Its `body` is
/// markdown; the optional `values` is a **frozen** snapshot of the chart's readout at
/// that time. See `docs/notes.md`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Note {
    /// Stable id (uuid v4 string).
    pub id: String,
    /// Creation time, in Unix milliseconds.
    pub created_ms: u64,
    /// Last-edit time, in Unix milliseconds.
    pub updated_ms: u64,
    /// The anchor instant, in source seconds.
    pub time_secs: f64,
    /// Optional span; absent = a point anchor.
    #[serde(default)]
    pub range: Option<AnalysisWindow>,
    /// The analyzer id the note was taken from; absent = a Timeline note.
    #[serde(default)]
    pub tool: Option<AnalyzerId>,
    /// Optional plain-text title.
    #[serde(default)]
    pub title: Option<String>,
    /// The markdown body (raw).
    #[serde(default)]
    pub body: String,
    /// The frozen values snapshot (absent for Timeline notes).
    #[serde(default)]
    pub values: Option<NoteValues>,
}

/// The frozen chart readout a note carries as its subtitle (`docs/notes.md`).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NoteValues {
    /// The analyzer the snapshot was taken from.
    pub tool: AnalyzerId,
    /// Human-readable label (e.g. `Spectrum @ 2.34 s`).
    pub label: String,
    /// The compact values line (the note's subtitle).
    pub text: String,
    /// The analysis window the snapshot was captured with.
    pub window: AnalysisWindow,
    /// The shared params the chart ran with.
    pub params: SharedParams,
    /// The per-tool options the chart ran with.
    #[serde(default)]
    pub options: BTreeMap<String, f64>,
    /// Capture time, in Unix milliseconds.
    pub captured_ms: u64,
}

/// `RESULTS` section entry: a cached analysis result.
///
/// Result caching is not wired up yet — the frontend re-derives results from the
/// embedded audio on load — so the section is written empty. The type is defined
/// now so the format stays forward-compatible when the cache lands.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StoredResult {
    /// The tool id that produced the result.
    pub tool: AnalyzerId,
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
