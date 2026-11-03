//! Unit tests for the batch CLI (split out of the module, grouped by subcommand).
//!
//! Shared fixtures live here; the tests themselves are in the sibling modules
//! ([`parse`] for matches → request mapping, [`run`] for execution, [`annotations`]).

use super::*;
use crate::audio::analyzers::AnalyzerId;
use crate::export::ExportFormat;

use serde_json::{json, Value};
use tauri_plugin_cli::Matches;

use crate::audio::graph::{GraphEdge, GraphNode, GraphSpec};

mod annotations;
mod compare;
mod options;
mod parse;
mod parse_project;
mod project;
mod run;

/// Build an `ArgData` the way the plugin's parser would (its fields are `pub`, but
/// the struct is `#[non_exhaustive]` so a literal will not compile outside the crate).
fn arg(value: Value) -> tauri_plugin_cli::ArgData {
    let mut arg = tauri_plugin_cli::ArgData::default();
    arg.value = value;
    arg.occurrences = 1;
    arg
}

pub(super) fn matches(entries: &[(&str, Value)]) -> Matches {
    let mut matches = Matches::default();
    for (name, value) in entries {
        matches.args.insert((*name).to_string(), arg(value.clone()));
    }
    matches
}

mod wav {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/support/wav.rs"));
}
pub(super) use wav::write_sine_wav;

/// A synth graph that renders a 440 Hz sine (`sine -> output`).
pub(super) fn sine_graph() -> GraphSpec {
    GraphSpec {
        nodes: vec![
            GraphNode {
                id: "osc".into(),
                kind: "sine".into(),
                params: vec![440.0],
            },
            GraphNode {
                id: "out".into(),
                kind: "output".into(),
                params: Vec::new(),
            },
        ],
        edges: vec![GraphEdge {
            from: "osc".into(),
            from_port: 0,
            to: "out".into(),
            to_port: 0,
        }],
    }
}

pub(super) fn write_synth_graph(name: &str) -> String {
    let path = std::env::temp_dir().join(name);
    let text = serde_json::to_string(&sine_graph()).unwrap();
    std::fs::write(&path, text).unwrap();
    path.to_string_lossy().into_owned()
}

/// A filter graph `input -> gain -> output` that scales the signal by `gain`.
pub(super) fn gain_filter(gain: f32) -> GraphSpec {
    GraphSpec {
        nodes: vec![
            GraphNode {
                id: "in".into(),
                kind: "input".into(),
                params: Vec::new(),
            },
            GraphNode {
                id: "g".into(),
                kind: "gain".into(),
                params: vec![gain],
            },
            GraphNode {
                id: "out".into(),
                kind: "output".into(),
                params: Vec::new(),
            },
        ],
        edges: vec![
            GraphEdge {
                from: "in".into(),
                from_port: 0,
                to: "g".into(),
                to_port: 0,
            },
            GraphEdge {
                from: "g".into(),
                from_port: 0,
                to: "out".into(),
                to_port: 0,
            },
        ],
    }
}

pub(super) fn analyze_request(files: Vec<String>, tools: Vec<String>) -> Request {
    Request {
        command: Command::Analyze,
        files,
        tools: parse_tools(&tools),
        all: false,
        start: None,
        end: None,
        a_start: None,
        a_end: None,
        b_start: None,
        b_end: None,
        overlap: false,
        b_offset: 0.0,
        windows: Vec::new(),
        params: Vec::new(),
        options: Vec::new(),
        filter: None,
        full: false,
        summary: false,
        format: ExportFormat::Json,
        out: None,
        pretty: false,
        fail_fast: false,
    }
}

/// A `synth` request over the standard sine graph, with the given label / length / tools.
pub(super) fn synth_request(path: &str, seconds: f64, tools: Vec<String>) -> Request {
    Request {
        command: Command::Synth {
            graph: sine_graph(),
            seconds,
            path: path.to_string(),
        },
        ..analyze_request(Vec::new(), tools)
    }
}

fn parse_tools(tools: &[String]) -> Vec<AnalyzerId> {
    tools
        .iter()
        .map(|tool| tool.parse().expect("a valid test tool id"))
        .collect()
}

/// Run a request that must produce exactly one JSON line, and return that line.
pub(super) fn run_single(request: &Request) -> Value {
    let mut out = Vec::new();
    assert_eq!(run(request, &mut out), 0);
    let mut values = lines(&out);
    assert_eq!(values.len(), 1);
    values.remove(0)
}

pub(super) fn lines(output: &[u8]) -> Vec<Value> {
    String::from_utf8_lossy(output)
        .lines()
        .map(|line| serde_json::from_str(line).expect("a JSON line"))
        .collect()
}
