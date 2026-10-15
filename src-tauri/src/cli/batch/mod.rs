//! Batch CLI logic: `analyzers` / `analyze` / `synth` / `notes`.
//!
//! A **windowless front end over the shared headless session** ([`HeadlessSession`],
//! the same engine facade `heylisten-mcp --headless` drives). It maps the parsed
//! `tauri-plugin-cli` matches onto a plain [`Request`], then runs it and prints one
//! self-describing JSON object per `file`/`tool` (JSONL, `jq`-streamable). Because the
//! work hangs off a `Request` and writes to an `impl Write` — never a `WebviewWindow` —
//! `cargo test` exercises it with no Tauri app and no display.
//!
//! There is no second DSP path: every step below is a `dispatch` call onto the headless
//! session, which reaches the same `analysis::run_window` / `audio::decode` /
//! `audio::graph` functions the GUI commands do. See `docs/cli.md` (ADR-14).
//!
//! The implementation is split by subcommand: [`args`] maps the matches onto a
//! [`Request`], [`analyze`] / [`analyzers`] / [`notes`] / [`synth`] run each
//! subcommand, and [`output`] writes the JSONL.

mod analyze;
mod analyzers;
mod args;
mod notes;
mod output;
mod synth;
mod types;

#[cfg(test)]
mod tests;

pub use args::{build_request, is_subcommand};
pub use types::*;

use std::io::Write;

use serde_json::{json, Map, Value};

use crate::mcp::dispatch::HeadlessSession;

use analyze::run_analyze;
use analyzers::run_analyzers;
use notes::run_notes;
use synth::run_synth;

/// Run a resolved batch request, writing JSONL (or one pretty object with `--pretty`)
/// to `out`. Returns the process exit code: `0` when every file/tool succeeded, `1`
/// when at least one failed. Usage errors are caught in [`build_request`] (exit `2`).
pub fn run(request: &Request, out: &mut impl Write) -> i32 {
    let mut session = HeadlessSession::default();

    // The --filter graph conditions the signal before analysis, through the same
    // headless `set_filter_graph` tool the MCP server exposes.
    if let Some(filter) = &request.filter {
        let graph = serde_json::to_value(filter).unwrap_or(Value::Null);
        if let Err(message) = session.dispatch(
            "set_filter_graph",
            json!({ "graph": graph, "enabled": true }),
        ) {
            eprintln!("hey-listen: {message}");
            return 2;
        }
    }

    // Shared params and per-tool options persist on the session across files/tools.
    if !request.params.is_empty() {
        let params: Map<String, Value> = request.params.iter().cloned().collect();
        if let Err(message) = session.dispatch("set_shared_params", json!({ "params": params })) {
            eprintln!("hey-listen: {message}");
            return 2;
        }
    }
    for patch in &request.options {
        let mut options = Map::new();
        options.insert(patch.key.clone(), patch.value.clone());
        let args = json!({ "tool": patch.tool, "options": Value::Object(options) });
        if let Err(message) = session.dispatch("set_tool_options", args) {
            eprintln!("hey-listen: {message}");
            return 2;
        }
    }

    match &request.command {
        Command::Analyzers { json } => run_analyzers(&mut session, *json, out),
        Command::Analyze => run_analyze(&mut session, request, out),
        Command::Notes { path, json, full } => run_notes(path, *json, *full, out),
        Command::Synth {
            graph,
            seconds,
            path,
        } => run_synth(&mut session, request, graph, *seconds, path, out),
    }
}
