//! Unit tests for the batch CLI (split out of the module, grouped by subcommand).
//!
//! Shared fixtures live here; the tests themselves are in the sibling modules
//! ([`parse`] for matches → request mapping, [`run`] for execution, [`notes`]).

use super::*;

use std::path::Path;

use serde_json::{json, Value};
use tauri_plugin_cli::Matches;

use crate::audio::graph::{GraphEdge, GraphNode, GraphSpec};

mod notes;
mod parse;
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

/// A minimal 16-bit PCM mono WAV with a half-scale 440 Hz sine.
pub(super) fn write_sine_wav(path: &Path, rate: u32, frames: usize) {
    let mut buf = Vec::new();
    let bits = 16u16;
    let block_align = bits / 8;
    let data_len = frames as u32 * u32::from(block_align);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_len).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&rate.to_le_bytes());
    buf.extend_from_slice(&(rate * u32::from(block_align)).to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits.to_le_bytes());
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());
    for f in 0..frames {
        let t = f as f32 / rate as f32;
        let sample = (t * 440.0 * std::f32::consts::TAU).sin() * 0.5;
        let value = (sample * f32::from(i16::MAX)) as i16;
        buf.extend_from_slice(&value.to_le_bytes());
    }
    std::fs::write(path, buf).unwrap();
}

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
        tools,
        all: false,
        start: None,
        end: None,
        params: Vec::new(),
        options: Vec::new(),
        filter: None,
        full: false,
        pretty: false,
        fail_fast: false,
    }
}

pub(super) fn lines(output: &[u8]) -> Vec<Value> {
    String::from_utf8_lossy(output)
        .lines()
        .map(|line| serde_json::from_str(line).expect("a JSON line"))
        .collect()
}
