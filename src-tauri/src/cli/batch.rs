//! Batch CLI logic: `analyzers` / `analyze` / `synth`.
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

use std::io::Write;

use serde_json::{json, Map, Value};
use tauri_plugin_cli::Matches;

use crate::audio::analyzers;
use crate::audio::graph::{self, GraphSpec};
use crate::mcp::dispatch::HeadlessSession;

/// The batch subcommands, matching the `plugins.cli` definitions in `tauri.conf.json`.
const SUBCOMMANDS: [&str; 4] = ["analyzers", "analyze", "synth", "notes"];

/// The shared-param keys `-p` accepts (the same keys MCP's `set_shared_params` takes).
const SHARED_PARAM_KEYS: [&str; 8] = [
    "fftSize",
    "hop",
    "randomizedOverlap",
    "windowFn",
    "channel",
    "resampleTo",
    "freqMinHz",
    "freqMaxHz",
];

/// The values `windowFn` accepts (`docs/analysis-tools.md`).
const WINDOW_FNS: [&str; 4] = ["hann", "hamming", "blackman", "rectangular"];

/// The per-tool option keys `-o` accepts (the same keys MCP's `set_tool_options` takes).
const TOOL_OPTION_KEYS: [&str; 11] = [
    "nMels",
    "nMfcc",
    "nBands",
    "rolloffPercent",
    "yinThreshold",
    "minF0Hz",
    "maxF0Hz",
    "barLength",
    "windowMs",
    "fMinHz",
    "fMaxHz",
];

/// Whether `name` is a batch subcommand (used to tell a real usage error from a
/// `.heyl` file path that the plugin's parser rejected).
pub fn is_subcommand(name: &str) -> bool {
    SUBCOMMANDS.contains(&name)
}

/// The command the batch CLI runs.
#[derive(Debug, Clone)]
pub enum Command {
    /// `analyzers [--json]` — list the catalog.
    Analyzers { json: bool },
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
}

/// One per-tool option patch, scoped to a tool.
#[derive(Debug, Clone)]
pub struct OptionPatch {
    pub tool: String,
    pub key: String,
    pub value: Value,
}

/// A fully-resolved batch request — the plain input [`run`] works over.
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
    /// Shared-param patches (`-p K=V`).
    pub params: Vec<(String, Value)>,
    /// Per-tool option patches (`-o [TOOL.]K=V`).
    pub options: Vec<OptionPatch>,
    /// A filter graph to condition the signal before analysis (`--filter`).
    pub filter: Option<GraphSpec>,
    pub full: bool,
    pub pretty: bool,
    pub fail_fast: bool,
}

/// Map a matched batch subcommand onto a [`Request`], or a usage-error message.
pub fn build_request(name: &str, matches: &Matches) -> Result<Request, String> {
    let mut request = common(matches)?;
    match name {
        "analyzers" => {
            request.command = Command::Analyzers {
                json: flag(matches, "json"),
            };
        }
        "analyze" => {
            request.files = strings(matches, "file");
            request.command = Command::Analyze;
        }
        "synth" => {
            let path = string(matches, "graph")
                .ok_or("synth needs a graph file: `hey-listen synth <GRAPH.json>`")?;
            let graph = read_synth_graph(&path)?;
            let seconds = match string(matches, "seconds") {
                Some(text) => text
                    .parse::<f64>()
                    .map_err(|_| format!("invalid --seconds: {text}"))?,
                None => 5.0,
            };
            request.command = Command::Synth {
                graph,
                seconds,
                path,
            };
        }
        "notes" => {
            let path = string(matches, "file")
                .ok_or("notes needs a project file: `hey-listen notes <FILE.heyl>`")?;
            request.command = Command::Notes {
                path,
                json: flag(matches, "json"),
                full: flag(matches, "full"),
            };
        }
        other => return Err(format!("unknown subcommand: {other}")),
    }
    validate(&request)?;
    Ok(request)
}

/// Parse the options shared by `analyze` and `synth` (everything but the command).
fn common(matches: &Matches) -> Result<Request, String> {
    let tools = strings(matches, "tool");
    let request = Request {
        command: Command::Analyze,
        files: Vec::new(),
        tools,
        all: flag(matches, "all"),
        start: optional_number(matches, "start")?,
        end: optional_number(matches, "end")?,
        params: parse_params(&strings(matches, "param"))?,
        options: parse_option_patches(&strings(matches, "option"), &strings(matches, "tool"))?,
        filter: match string(matches, "filter") {
            Some(path) => Some(read_filter_graph(&path)?),
            None => None,
        },
        full: flag(matches, "full"),
        pretty: flag(matches, "pretty"),
        fail_fast: flag(matches, "fail-fast"),
    };
    Ok(request)
}

/// Reject a request the CLI cannot honour (missing files/tools, a `--pretty` stream).
fn validate(request: &Request) -> Result<(), String> {
    match &request.command {
        Command::Analyzers { .. } => {}
        Command::Analyze => {
            if request.files.is_empty() {
                return Err(
                    "analyze needs at least one file: `hey-listen analyze <FILE>...`".into(),
                );
            }
            if request.tools.is_empty() && !request.all {
                return Err("analyze needs `-t <TOOL>` (or `--all`)".into());
            }
        }
        Command::Synth { seconds, .. } => {
            if !seconds.is_finite() || *seconds <= 0.0 {
                return Err(format!(
                    "--seconds must be a positive number, got {seconds}"
                ));
            }
        }
        Command::Notes { .. } => {}
    }
    if request.pretty && result_count(request) != 1 {
        return Err("--pretty prints a single result; give exactly one file and one tool".into());
    }
    Ok(())
}

/// How many result lines a request produces (for the `--pretty` check).
fn result_count(request: &Request) -> usize {
    match &request.command {
        Command::Analyzers { .. } => 0,
        Command::Analyze => request.files.len() * tool_count(request),
        Command::Synth { .. } => tool_count(request),
        Command::Notes { .. } => 0,
    }
}

/// The number of tools a request runs (`--all` selects the whole catalog).
fn tool_count(request: &Request) -> usize {
    if request.all {
        analyzers::ANALYZERS.len()
    } else {
        request.tools.len()
    }
}

// --- parsing helpers -----------------------------------------------------

fn strings(matches: &Matches, name: &str) -> Vec<String> {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn string(matches: &Matches, name: &str) -> Option<String> {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_str())
        .map(str::to_string)
}

fn flag(matches: &Matches, name: &str) -> bool {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_bool())
        .unwrap_or(false)
}

fn optional_number(matches: &Matches, name: &str) -> Result<Option<f64>, String> {
    match string(matches, name) {
        Some(text) => text
            .parse::<f64>()
            .map(Some)
            .map_err(|_| format!("invalid --{name}: {text}")),
        None => Ok(None),
    }
}

/// Split a `K=V` token, parsing `V` into a JSON value.
fn split_kv(token: &str) -> Result<(String, Value), String> {
    let (key, value) = token
        .split_once('=')
        .ok_or_else(|| format!("expected K=V, got `{token}`"))?;
    if key.is_empty() {
        return Err(format!("empty key in `{token}`"));
    }
    Ok((key.to_string(), parse_value(value)))
}

/// Parse a flag/value string into JSON: `true`/`false` → bool, `none`/`null` → null,
/// an integer → number, a float → number, anything else → string.
fn parse_value(text: &str) -> Value {
    match text {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        "none" | "null" => Value::Null,
        _ => {
            if let Ok(int) = text.parse::<i64>() {
                Value::from(int)
            } else if let Ok(float) = text.parse::<f64>() {
                Value::from(float)
            } else {
                Value::String(text.to_string())
            }
        }
    }
}

fn parse_params(tokens: &[String]) -> Result<Vec<(String, Value)>, String> {
    let mut params = Vec::new();
    for token in tokens {
        let (key, value) = split_kv(token)?;
        if !SHARED_PARAM_KEYS.contains(&key.as_str()) {
            return Err(format!("unknown shared param: {key}"));
        }
        validate_param(&key, &value)?;
        params.push((key, value));
    }
    Ok(params)
}

fn validate_param(key: &str, value: &Value) -> Result<(), String> {
    let ok = match key {
        "fftSize" => value.as_u64().is_some(),
        "hop" | "freqMinHz" | "freqMaxHz" => value.as_f64().is_some(),
        "randomizedOverlap" => value.is_boolean(),
        "windowFn" => value
            .as_str()
            .is_some_and(|name| WINDOW_FNS.contains(&name)),
        "channel" | "resampleTo" => value.is_null() || value.as_u64().is_some(),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(format!("bad value for shared param {key}: {value}"))
    }
}

/// Parse `-o` patches. A token is `[TOOL.]KEY=VALUE`; a bare `KEY=VALUE` is scoped to
/// the sole `--tool` (there is no other way to tell which tool it belongs to, since the
/// plugin's matches do not preserve the order of flags on the command line).
fn parse_option_patches(tokens: &[String], tools: &[String]) -> Result<Vec<OptionPatch>, String> {
    let mut patches = Vec::new();
    for token in tokens {
        let (lhs, value) = split_kv(token)?;
        let (tool, key) = match lhs.split_once('.') {
            Some((tool, key)) => (tool.to_string(), key.to_string()),
            None if tools.len() == 1 => (tools[0].clone(), lhs),
            None => {
                return Err(format!(
                    "`-o {token}` must name its tool when several are run: use `-o <TOOL>.<KEY>=<VALUE>`"
                ))
            }
        };
        if !analyzers::is_analyzer(&tool) {
            return Err(format!("unknown analyzer in `-o`: {tool}"));
        }
        if !TOOL_OPTION_KEYS.contains(&key.as_str()) {
            return Err(format!("unknown option for {tool}: {key}"));
        }
        patches.push(OptionPatch { tool, key, value });
    }
    Ok(patches)
}

fn read_graph(path: &str) -> Result<GraphSpec, String> {
    let text = std::fs::read_to_string(path).map_err(|err| format!("cannot read {path}: {err}"))?;
    serde_json::from_str::<GraphSpec>(&text).map_err(|err| format!("invalid graph {path}: {err}"))
}

/// Read a `--filter` graph and check that it compiles as a filter (one global input).
fn read_filter_graph(path: &str) -> Result<GraphSpec, String> {
    let spec = read_graph(path)?;
    if !spec.is_empty() {
        graph::build(&spec, 1, 48_000)
            .map_err(|err| format!("invalid filter graph {path}: {err}"))?;
    }
    Ok(spec)
}

/// Read a `synth` graph and check that it compiles as a synth (no global input).
fn read_synth_graph(path: &str) -> Result<GraphSpec, String> {
    let spec = read_graph(path)?;
    graph::build(&spec, 0, 48_000).map_err(|err| format!("invalid synth graph {path}: {err}"))?;
    Ok(spec)
}

// --- running -------------------------------------------------------------

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
        } => {
            let graph_value = serde_json::to_value(graph).unwrap_or(Value::Null);
            let summary = match session.dispatch(
                "render_synth",
                json!({ "graph": graph_value, "seconds": seconds }),
            ) {
                Ok(summary) => summary,
                Err(message) => {
                    emit(out, &json!({ "file": path, "error": message }), false);
                    return 1;
                }
            };

            // With no tools, `synth` reports the rendered source instead of analyzing it.
            if request.tools.is_empty() && !request.all {
                emit(out, &json!({ "file": path, "source": summary }), false);
                return 0;
            }
            let tools = tools_for(request);
            if run_tools(&mut session, request, &tools, path, out).is_err() {
                return 1;
            }
            0
        }
    }
}

/// List the catalog: JSON array (`--json`) or an `id  section  title` table.
fn run_analyzers(session: &mut HeadlessSession, json: bool, out: &mut impl Write) -> i32 {
    match session.dispatch("list_analyzers", json!({})) {
        Ok(Value::Array(items)) => {
            if json {
                emit(out, &Value::Array(items), false);
            } else {
                for item in items {
                    let _ = writeln!(
                        out,
                        "{}\t{}\t{}",
                        item["id"].as_str().unwrap_or(""),
                        item["section"].as_str().unwrap_or(""),
                        item["title"].as_str().unwrap_or(""),
                    );
                }
            }
            0
        }
        Ok(other) => {
            emit(out, &other, false);
            0
        }
        Err(message) => {
            eprintln!("hey-listen: {message}");
            1
        }
    }
}

/// List a saved project's notes, sorted by time (read-only).
///
/// Decodes the `.heyl` container and reads its `NOTES` section. Prints one JSON line
/// per note (`--json`) or a table; a file with no notes prints nothing and exits `0`.
/// A missing / unreadable / non-project file is an `error` (exit `1`).
fn run_notes(path: &str, json: bool, full: bool, out: &mut impl Write) -> i32 {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(err) => {
            emit(
                out,
                &json!({ "file": path, "error": err.to_string() }),
                false,
            );
            return 1;
        }
    };
    let mut notes = match crate::project::read_project(&mut file) {
        Ok(loaded) => loaded.notes,
        Err(err) => {
            emit(
                out,
                &json!({ "file": path, "error": err.to_string() }),
                false,
            );
            return 1;
        }
    };
    notes.sort_by(|a, b| a.time_secs.total_cmp(&b.time_secs));

    for note in &notes {
        if json {
            let mut value = serde_json::to_value(note).unwrap_or(Value::Null);
            if !full {
                if let Some(object) = value.as_object_mut() {
                    object.insert("body".to_string(), json!(excerpt(&note.body)));
                }
            }
            emit(out, &value, false);
        } else {
            let time = match &note.range {
                Some(range) => format!("{:.3}–{:.3}", range.start_secs, range.end_secs),
                None => format!("{:.3}", note.time_secs),
            };
            let label = match note.title.as_deref() {
                Some(title) if !title.is_empty() => title.to_string(),
                _ if full => note.body.replace('\n', " "),
                _ => excerpt(&note.body),
            };
            let values = note.values.as_ref().map(|v| v.text.as_str()).unwrap_or("");
            let _ = writeln!(
                out,
                "{time}\t{}\t{label}\t{values}",
                note.tool.as_deref().unwrap_or("-"),
            );
        }
    }
    0
}

/// A one-line excerpt of a markdown body for the table / default JSON output.
fn excerpt(body: &str) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let mut short: String = line.chars().take(60).collect();
    if line.chars().count() > 60 {
        short.push('…');
    }
    short
}

/// Decode each file in turn and run the requested tools over it.
fn run_analyze(session: &mut HeadlessSession, request: &Request, out: &mut impl Write) -> i32 {
    let tools = tools_for(request);
    let mut failed = false;
    for file in &request.files {
        if let Err(message) = session.dispatch("open_audio_file", json!({ "path": file })) {
            emit(
                out,
                &json!({ "file": file, "error": message }),
                request.pretty,
            );
            failed = true;
            if request.fail_fast {
                return 1;
            }
            continue;
        }
        if run_tools(session, request, &tools, file, out).is_err() {
            failed = true;
            if request.fail_fast {
                return 1;
            }
        }
    }
    if failed {
        1
    } else {
        0
    }
}

/// The tool ids to run: the catalog when `--all`, else the requested `-t` ids.
fn tools_for(request: &Request) -> Vec<String> {
    if request.all {
        analyzers::ANALYZERS
            .iter()
            .map(|analyzer| analyzer.id.to_string())
            .collect()
    } else {
        request.tools.clone()
    }
}

/// Run every tool over the session's current source, emitting one line per tool.
///
/// Returns `Ok(())` when all tools succeeded, `Err(())` when at least one failed
/// (short-circuiting on the first failure when `--fail-fast` is set).
fn run_tools(
    session: &mut HeadlessSession,
    request: &Request,
    tools: &[String],
    label: &str,
    out: &mut impl Write,
) -> Result<(), ()> {
    let mut failed = false;
    for tool in tools {
        let mut args = json!({ "tool": tool });
        if let Some(start) = request.start {
            args["start"] = json!(start);
        }
        if let Some(end) = request.end {
            args["end"] = json!(end);
        }
        if request.full {
            args["includeData"] = json!(true);
        }

        match session.dispatch("run_analysis", args) {
            Ok(mut result) => {
                if let Some(object) = result.as_object_mut() {
                    object.insert("file".to_string(), json!(label));
                }
                emit(out, &result, request.pretty);
            }
            Err(message) => {
                emit(
                    out,
                    &json!({ "file": label, "tool": tool, "error": message }),
                    request.pretty,
                );
                failed = true;
                if request.fail_fast {
                    return Err(());
                }
            }
        }
    }
    if failed {
        Err(())
    } else {
        Ok(())
    }
}

/// Write one result object (compact JSONL, or pretty-printed).
fn emit(out: &mut impl Write, value: &Value, pretty: bool) {
    let text = if pretty {
        serde_json::to_string_pretty(value)
    } else {
        serde_json::to_string(value)
    }
    .unwrap_or_default();
    let _ = writeln!(out, "{text}");
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::Path;

    use crate::audio::graph::{GraphEdge, GraphNode};

    /// Build an `ArgData` the way the plugin's parser would (its fields are `pub`, but
    /// the struct is `#[non_exhaustive]` so a literal will not compile outside the crate).
    fn arg(value: Value) -> tauri_plugin_cli::ArgData {
        let mut arg = tauri_plugin_cli::ArgData::default();
        arg.value = value;
        arg.occurrences = 1;
        arg
    }

    fn matches(entries: &[(&str, Value)]) -> Matches {
        let mut matches = Matches::default();
        for (name, value) in entries {
            matches.args.insert((*name).to_string(), arg(value.clone()));
        }
        matches
    }

    // --- Matches -> Request mapping --------------------------------------

    #[test]
    fn analyze_maps_files_tools_params_and_window() {
        let m = matches(&[
            ("file", json!(["a.wav", "b.wav"])),
            ("tool", json!(["spectrum", "tempo"])),
            (
                "param",
                json!(["fftSize=8192", "windowFn=hamming", "randomizedOverlap=true"]),
            ),
            ("option", json!(["spectrum.nMels=40"])),
            ("start", json!("10")),
            ("end", json!("14")),
            ("full", json!(true)),
        ]);
        let request = build_request("analyze", &m).unwrap();
        assert!(matches!(&request.command, Command::Analyze));
        assert_eq!(request.files, ["a.wav", "b.wav"]);
        assert_eq!(request.tools, ["spectrum", "tempo"]);
        assert_eq!(request.start, Some(10.0));
        assert_eq!(request.end, Some(14.0));
        assert!(request.full);
        assert!(request
            .params
            .contains(&("fftSize".to_string(), json!(8192))));
        assert!(request
            .params
            .contains(&("windowFn".to_string(), json!("hamming"))));
        assert!(request
            .params
            .contains(&("randomizedOverlap".to_string(), json!(true))));
        assert_eq!(request.options.len(), 1);
        assert_eq!(request.options[0].tool, "spectrum");
        assert_eq!(request.options[0].key, "nMels");
        assert_eq!(request.options[0].value, json!(40));
    }

    #[test]
    fn analyze_needs_a_file_and_a_tool() {
        assert!(build_request("analyze", &matches(&[])).is_err());

        let no_tool = matches(&[("file", json!(["a.wav"]))]);
        assert!(build_request("analyze", &no_tool).is_err());

        // `--all` satisfies the tool requirement.
        let all = matches(&[("file", json!(["a.wav"])), ("all", json!(true))]);
        assert!(build_request("analyze", &all).is_ok());
    }

    #[test]
    fn bad_params_are_rejected() {
        let base = |param: &str| {
            matches(&[
                ("file", json!(["a.wav"])),
                ("tool", json!(["spectrum"])),
                ("param", json!([param])),
            ])
        };
        assert!(build_request("analyze", &base("nope=1"))
            .unwrap_err()
            .contains("unknown shared param"));
        assert!(build_request("analyze", &base("windowFn=triangular")).is_err());
        assert!(build_request("analyze", &base("fftSize=lots")).is_err());
        assert!(build_request("analyze", &base("fftSize")).is_err());
    }

    #[test]
    fn option_without_a_tool_prefix_needs_a_single_tool() {
        let two = matches(&[
            ("file", json!(["a.wav"])),
            ("tool", json!(["spectrum", "tempo"])),
            ("option", json!(["nMels=40"])),
        ]);
        assert!(build_request("analyze", &two).is_err());

        let one = matches(&[
            ("file", json!(["a.wav"])),
            ("tool", json!(["spectrum"])),
            ("option", json!(["nMels=40"])),
        ]);
        let request = build_request("analyze", &one).unwrap();
        assert_eq!(request.options[0].tool, "spectrum");
    }

    #[test]
    fn unknown_option_key_is_rejected() {
        let m = matches(&[
            ("file", json!(["a.wav"])),
            ("tool", json!(["spectrum"])),
            ("option", json!(["spectrum.nope=1"])),
        ]);
        assert!(build_request("analyze", &m)
            .unwrap_err()
            .contains("unknown option"));
    }

    #[test]
    fn pretty_needs_a_single_result() {
        let m = matches(&[
            ("file", json!(["a.wav", "b.wav"])),
            ("tool", json!(["spectrum"])),
            ("pretty", json!(true)),
        ]);
        assert!(build_request("analyze", &m)
            .unwrap_err()
            .contains("--pretty"));
    }

    #[test]
    fn analyzers_reads_the_json_flag() {
        let m = matches(&[("json", json!(true))]);
        let request = build_request("analyzers", &m).unwrap();
        assert!(matches!(request.command, Command::Analyzers { json: true }));
    }

    #[test]
    fn synth_reads_the_graph_and_seconds() {
        let path = write_synth_graph("hey_listen_cli_synth_graph.json");
        let m = matches(&[("graph", json!(path)), ("seconds", json!("2"))]);
        let request = build_request("synth", &m).unwrap();
        match request.command {
            Command::Synth {
                seconds, path: p, ..
            } => {
                assert_eq!(seconds, 2.0);
                assert_eq!(p, path);
            }
            _ => panic!("expected a synth command"),
        }
    }

    #[test]
    fn synth_without_a_graph_is_a_usage_error() {
        assert!(build_request("synth", &matches(&[]))
            .unwrap_err()
            .contains("graph"));
    }

    // --- running (no Tauri app, no display) ------------------------------

    /// A minimal 16-bit PCM mono WAV with a half-scale 440 Hz sine.
    fn write_sine_wav(path: &Path, rate: u32, frames: usize) {
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
    fn sine_graph() -> GraphSpec {
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

    fn write_synth_graph(name: &str) -> String {
        let path = std::env::temp_dir().join(name);
        let text = serde_json::to_string(&sine_graph()).unwrap();
        std::fs::write(&path, text).unwrap();
        path.to_string_lossy().into_owned()
    }

    /// A filter graph `input -> gain -> output` that scales the signal by `gain`.
    fn gain_filter(gain: f32) -> GraphSpec {
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

    fn analyze_request(files: Vec<String>, tools: Vec<String>) -> Request {
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

    fn lines(output: &[u8]) -> Vec<Value> {
        String::from_utf8_lossy(output)
            .lines()
            .map(|line| serde_json::from_str(line).expect("a JSON line"))
            .collect()
    }

    #[test]
    fn run_applies_a_filter_before_analysis() {
        let path = std::env::temp_dir().join("hey_listen_cli_filter.wav");
        write_sine_wav(&path, 8_000, 8_000);
        let mut request = analyze_request(
            vec![path.to_string_lossy().into_owned()],
            vec!["levels".into()],
        );
        request.filter = Some(gain_filter(0.5));

        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 0);
        let values = lines(&out);
        // The 0.5-amplitude sine is halved by the 0.5 gain filter.
        let peak = values[0]["result"]["peak"].as_f64().unwrap();
        assert!((0.20..0.30).contains(&peak), "filtered peak: {peak}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_filter_graph_is_checked_when_it_is_mapped() {
        let path = std::env::temp_dir().join("hey_listen_cli_bad_filter.json");
        // A synth-style graph (no `input` anchor) is not a valid filter.
        std::fs::write(&path, serde_json::to_string(&sine_graph()).unwrap()).unwrap();
        let m = matches(&[
            ("file", json!(["a.wav"])),
            ("tool", json!(["levels"])),
            ("filter", json![path.to_string_lossy().into_owned()]),
        ]);
        assert!(build_request("analyze", &m)
            .unwrap_err()
            .contains("filter graph"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn run_finds_the_spectrum_peak() {
        let path = std::env::temp_dir().join("hey_listen_cli_peak.wav");
        write_sine_wav(&path, 8_000, 8_000);
        let file = path.to_string_lossy().into_owned();
        let request = analyze_request(vec![file.clone()], vec!["spectrum".into()]);

        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 0);

        let values = lines(&out);
        assert_eq!(values.len(), 1);
        assert_eq!(values[0]["file"], file);
        // The `tool` tag lives in the result, not duplicated on the envelope.
        assert_eq!(values[0]["result"]["tool"], "spectrum");
        let peak = values[0]["result"]["peakHz"].as_f64().unwrap();
        assert!(
            (380.0..500.0).contains(&peak),
            "peak Hz out of range: {peak}"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn run_prints_one_line_per_file() {
        let a = std::env::temp_dir().join("hey_listen_cli_a.wav");
        let b = std::env::temp_dir().join("hey_listen_cli_b.wav");
        write_sine_wav(&a, 8_000, 4_000);
        write_sine_wav(&b, 8_000, 4_000);
        let request = analyze_request(
            vec![
                a.to_string_lossy().into_owned(),
                b.to_string_lossy().into_owned(),
            ],
            vec!["levels".into()],
        );

        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 0);
        assert_eq!(lines(&out).len(), 2);
        let _ = std::fs::remove_file(&a);
        let _ = std::fs::remove_file(&b);
    }

    #[test]
    fn run_reports_an_unknown_tool_as_an_error_line() {
        let path = std::env::temp_dir().join("hey_listen_cli_unknown.wav");
        write_sine_wav(&path, 8_000, 4_000);
        let request = analyze_request(
            vec![path.to_string_lossy().into_owned()],
            vec!["nope".into()],
        );

        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 1);
        let values = lines(&out);
        assert_eq!(values[0]["tool"], "nope");
        assert!(values[0]["error"]
            .as_str()
            .unwrap()
            .contains("unknown analyzer"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn run_reports_a_missing_file() {
        let request = analyze_request(vec!["/no/such/file.wav".into()], vec!["levels".into()]);
        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 1);
        let values = lines(&out);
        assert_eq!(values[0]["file"], "/no/such/file.wav");
        assert!(values[0]["error"].is_string());
        assert!(values[0].get("tool").is_none());
    }

    #[test]
    fn run_lists_the_catalog_as_json_or_a_table() {
        let mut session = HeadlessSession::default();

        let mut json_out = Vec::new();
        assert_eq!(run_analyzers(&mut session, true, &mut json_out), 0);
        let catalog: Vec<Value> = serde_json::from_slice(&json_out).unwrap();
        assert!(catalog.iter().any(|item| item["id"] == "spectrum"));

        let mut table_out = Vec::new();
        assert_eq!(run_analyzers(&mut session, false, &mut table_out), 0);
        let table = String::from_utf8(table_out).unwrap();
        assert!(table.contains("spectrum\tspectral\tSpectrum"));
    }

    #[test]
    fn run_renders_a_synth() {
        let path = write_synth_graph("hey_listen_cli_synth_run.json");
        let request = Request {
            command: Command::Synth {
                graph: sine_graph(),
                seconds: 0.5,
                path: path.clone(),
            },
            files: Vec::new(),
            tools: vec!["levels".into()],
            all: false,
            start: None,
            end: None,
            params: Vec::new(),
            options: Vec::new(),
            filter: None,
            full: false,
            pretty: false,
            fail_fast: false,
        };

        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 0);
        let values = lines(&out);
        assert_eq!(values.len(), 1);
        assert_eq!(values[0]["file"], path);
        assert_eq!(values[0]["result"]["tool"], "levels");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn run_reports_a_synth_source_when_no_tool_is_given() {
        let path = write_synth_graph("hey_listen_cli_synth_summary.json");
        let request = Request {
            command: Command::Synth {
                graph: sine_graph(),
                seconds: 0.25,
                path: path.clone(),
            },
            files: Vec::new(),
            tools: Vec::new(),
            all: false,
            start: None,
            end: None,
            params: Vec::new(),
            options: Vec::new(),
            filter: None,
            full: false,
            pretty: false,
            fail_fast: false,
        };

        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 0);
        let values = lines(&out);
        assert_eq!(values.len(), 1);
        assert_eq!(values[0]["file"], path);
        assert_eq!(values[0]["source"]["sampleRate"], 48_000);
        let _ = std::fs::remove_file(&path);
    }

    // --- notes -----------------------------------------------------------

    /// Write a `.heyl` with two notes (a chart note with values, a timeline range note).
    fn write_project_file(name: &str) -> String {
        use crate::project::sections::{AnalysisWindow, NoteValues};
        use crate::project::{write_project, Note, SaveProject};
        let path = std::env::temp_dir().join(name);
        let chart_note = Note {
            id: "n1".into(),
            created_ms: 1,
            updated_ms: 2,
            time_secs: 2.5,
            range: None,
            tool: Some("spectrum".into()),
            title: Some("Third harmonic".into()),
            body: "Peak at **880 Hz**\nsecond line".into(),
            values: Some(NoteValues {
                tool: "spectrum".into(),
                label: "Spectrum @ 2.5 s".into(),
                text: "peak 880.0 Hz".into(),
                window: AnalysisWindow {
                    start_secs: 0.0,
                    end_secs: 4.0,
                },
                params: Default::default(),
                options: Default::default(),
                captured_ms: 2,
            }),
        };
        let timeline_note = Note {
            id: "n0".into(),
            created_ms: 1,
            updated_ms: 1,
            time_secs: 1.0,
            range: Some(AnalysisWindow {
                start_secs: 1.0,
                end_secs: 1.5,
            }),
            tool: None,
            title: None,
            body: "a timeline note".into(),
            values: None,
        };
        let save = SaveProject {
            name: "notes".into(),
            created_ms: None,
            source: None,
            setup: crate::project::AnalysisSetup::default(),
            layout: Value::Null,
            results: Vec::new(),
            notes: vec![chart_note, timeline_note],
            pcm: None,
        };
        let file = std::fs::File::create(&path).unwrap();
        write_project(std::io::BufWriter::new(file), &save, 10).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn notes_reads_the_file_and_flags() {
        let m = matches(&[
            ("file", json!("/tmp/x.heyl")),
            ("json", json!(true)),
            ("full", json!(true)),
        ]);
        let request = build_request("notes", &m).unwrap();
        match request.command {
            Command::Notes { path, json, full } => {
                assert_eq!(path, "/tmp/x.heyl");
                assert!(json);
                assert!(full);
            }
            _ => panic!("expected a notes command"),
        }
    }

    #[test]
    fn notes_without_a_file_is_a_usage_error() {
        assert!(build_request("notes", &matches(&[]))
            .unwrap_err()
            .contains("project file"));
    }

    #[test]
    fn run_lists_notes_sorted_by_time() {
        let path = write_project_file("hey_listen_cli_notes.heyl");

        // JSONL, full bodies.
        let m = matches(&[
            ("file", json!(path.clone())),
            ("json", json!(true)),
            ("full", json!(true)),
        ]);
        let request = build_request("notes", &m).unwrap();
        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 0);
        let values = lines(&out);
        assert_eq!(values.len(), 2);
        // Sorted by time: the timeline note (1.0 s) before the chart note (2.5 s).
        assert_eq!(values[0]["id"], "n0");
        assert_eq!(values[1]["id"], "n1");
        assert_eq!(values[1]["body"], "Peak at **880 Hz**\nsecond line");
        assert_eq!(values[1]["values"]["text"], "peak 880.0 Hz");

        // Table output, excerpted bodies.
        let m = matches(&[("file", json!(path.clone()))]);
        let request = build_request("notes", &m).unwrap();
        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 0);
        let table = String::from_utf8(out).unwrap();
        assert!(table.contains("2.500\tspectrum\tThird harmonic\tpeak 880.0 Hz"));
        assert!(table.contains("1.000–1.500\t-\ta timeline note\t"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn run_reports_a_missing_project() {
        let m = matches(&[("file", json!("/no/such/x.heyl"))]);
        let request = build_request("notes", &m).unwrap();
        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 1);
        let values = lines(&out);
        assert!(values[0]["error"].is_string());
    }
}
