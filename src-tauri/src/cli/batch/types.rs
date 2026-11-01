//! The plain batch request types: the command, a per-tool option patch, and the
//! fully-resolved [`Request`] the runner ([`run`](super::run)) works over.

use serde_json::Value;

use crate::audio::analyzers::{AnalyzerId, ToolId};
use crate::audio::graph::GraphSpec;
use crate::export::ExportFormat;

/// Where `--out` writes: one explicit file (a single result) or a directory (one file
/// per result).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputTarget {
    File(String),
    Dir(String),
}

/// The batch subcommand names, matching the `plugins.cli` definitions in
/// `tauri.conf.json`.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    strum::EnumString,
    strum::Display,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::EnumIter,
    strum::VariantNames,
)]
#[strum(serialize_all = "lowercase")]
pub enum BatchCommand {
    Analyzers,
    Analyze,
    Synth,
    Notes,
    Compare,
    Project,
}

/// The command the batch CLI runs.
#[derive(Debug, Clone)]
pub enum Command {
    /// `analyzers [ID] [--json]` — list the catalog, or explain one analyzer.
    Analyzers { id: Option<String>, json: bool },
    /// `analyze <FILE>...` — decode each file and run the tools over a window.
    Analyze,
    /// `synth <GRAPH.json> [--seconds SEC]` — render a synth graph, then analyze it.
    Synth {
        graph: GraphSpec,
        seconds: f64,
        /// The graph file path (used as the `file` label in the output).
        path: String,
    },
    /// `notes <FILE.heyl>` — list, add, get, update or delete a saved project's notes.
    Notes {
        path: String,
        json: bool,
        full: bool,
        /// What to do with the notes (list by default).
        op: NotesOp,
        /// For a mutation, write to this copy instead of in place.
        to: Option<String>,
    },
    /// `compare <A.heyl> <B.heyl> -t TOOL` — diff one tool across two project files.
    Compare {
        a: String,
        b: String,
        /// Write the owner (A) back to this path with the comparison snapshots (M25.D).
        save: Option<String>,
        /// Override A's `SETUP.openTools` when saving.
        open_tools: Vec<ToolId>,
    },
    /// `project <OUT.heyl>` — build a project from a source + setup + tabs, windowless.
    ProjectSave {
        path: String,
        /// Audio file to decode as the source.
        source: Option<String>,
        /// Synth graph + render length (mutually exclusive with `source`).
        synth: Option<(GraphSpec, f64)>,
        /// Project display name (default: the output file stem).
        name: Option<String>,
        /// The analyzer tabs to restore (`SETUP.openTools`).
        open_tools: Vec<ToolId>,
        /// Annotations to write (the same objects MCP's `save_project` takes).
        notes: Vec<Value>,
        /// Write a reference project (no embedded audio) for a file source.
        reference: bool,
    },
}

/// What a `notes` invocation does (exactly one operation, or a plain listing).
#[derive(Debug, Clone)]
pub enum NotesOp {
    /// List every note, sorted by time.
    List,
    /// Append the notes in this JSON array file.
    Add { file: String },
    /// Print one note by id (the full body and frozen values).
    Get { id: String },
    /// Patch one note; `patch` is the parsed `--set K=V` list.
    Update {
        id: String,
        patch: Vec<(String, Value)>,
    },
    /// Remove one note by id.
    Delete { id: String },
}

/// One per-tool option patch, scoped to a tool.
#[derive(Debug, Clone)]
pub struct OptionPatch {
    pub tool: AnalyzerId,
    pub key: String,
    pub value: Value,
}

/// One analysis window from `--windows FILE`: `start,end[,tool,tool…]` per line.
///
/// A window without tools falls back to the request's `-t` / `--all`, so a sweep can
/// share one tool list or override it per window. This is what makes "1k windows in
/// one file" one process instead of 1k process startups (M21.B).
#[derive(Debug, Clone, PartialEq)]
pub struct WindowSpec {
    pub start: f64,
    pub end: f64,
    pub tools: Vec<AnalyzerId>,
}

/// A fully-resolved batch request — the plain input [`run`](super::run) works over.
#[derive(Debug, Clone)]
pub struct Request {
    pub command: Command,
    /// Input files (`analyze`); empty for `analyzers` / `synth`.
    pub files: Vec<String>,
    /// Analyzer ids to run (`-t`, repeatable).
    pub tools: Vec<AnalyzerId>,
    /// Run every analyzer in the catalog (`--all`).
    pub all: bool,
    pub start: Option<f64>,
    pub end: Option<f64>,
    /// Per-side window overrides for `compare` (`--a-start` / `--b-end`, …).
    pub a_start: Option<f64>,
    pub a_end: Option<f64>,
    pub b_start: Option<f64>,
    pub b_end: Option<f64>,
    /// Clip both sides to their absolute-time intersection (`compare --overlap`).
    pub overlap: bool,
    /// Move side B on the relative axis (`compare --b-offset`, positive = later).
    pub b_offset: f64,
    /// Per-window analysis list (`--windows FILE`); empty for a single window.
    pub windows: Vec<WindowSpec>,
    /// Shared-param patches (`-p K=V`).
    pub params: Vec<(String, Value)>,
    /// Per-tool option patches (`-o [TOOL.]K=V`).
    pub options: Vec<OptionPatch>,
    /// A filter graph to condition the signal before analysis (`--filter`).
    pub filter: Option<GraphSpec>,
    /// Return the raw result arrays (`--full`).
    pub full: bool,
    /// Return the summary only, without result arrays (`--summary`).
    pub summary: bool,
    /// Data export format: JSONL to stdout (the default) or CSV / envelope files.
    pub format: ExportFormat,
    /// Write results to a file or directory instead of stdout (`--out`).
    pub out: Option<OutputTarget>,
    pub pretty: bool,
    pub fail_fast: bool,
}
