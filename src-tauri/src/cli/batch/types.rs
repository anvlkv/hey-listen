//! The plain batch request types: the command, a per-tool option patch, and the
//! fully-resolved [`Request`] the runner ([`run`](super::run)) works over.

use serde_json::Value;

use crate::audio::graph::GraphSpec;
use crate::export::ExportFormat;

/// Where `--out` writes: one explicit file (a single result) or a directory (one file
/// per result).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputTarget {
    File(String),
    Dir(String),
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
    /// `notes <FILE.heyl>` — list a saved project's notes (read-only).
    Notes {
        path: String,
        json: bool,
        full: bool,
    },
    /// `compare <A.heyl> <B.heyl> -t TOOL` — diff one tool across two project files.
    Compare { a: String, b: String },
}

/// One per-tool option patch, scoped to a tool.
#[derive(Debug, Clone)]
pub struct OptionPatch {
    pub tool: String,
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
    pub tools: Vec<String>,
}

/// A fully-resolved batch request — the plain input [`run`](super::run) works over.
#[derive(Debug, Clone)]
pub struct Request {
    pub command: Command,
    /// Input files (`analyze`); empty for `analyzers` / `synth`.
    pub files: Vec<String>,
    /// Analyzer ids to run (`-t`, repeatable).
    pub tools: Vec<String>,
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
