//! Request mapping: turn parsed `tauri-plugin-cli` matches into a [`Request`], with
//! the shared validation and the `-p` / `-o` / graph-file parsing helpers.

use serde_json::Value;
use tauri_plugin_cli::Matches;

use crate::audio::analysis::canonical_option_key;
use crate::audio::analyzers;
use crate::audio::graph::{self, GraphSpec};

use super::types::{Command, OptionPatch, Request};

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

/// Whether `name` is a batch subcommand (used to tell a real usage error from a
/// `.heyl` file path that the plugin's parser rejected).
pub fn is_subcommand(name: &str) -> bool {
    SUBCOMMANDS.contains(&name)
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
        // Canonicalize camelCase / snake_case (`min_f0_hz` → `minF0Hz`) so the same
        // keys MCP's `set_tool_options` takes work here too.
        let key = canonical_option_key(&key)
            .ok_or_else(|| format!("unknown option for {tool}: {key}"))?;
        patches.push(OptionPatch {
            tool,
            key: key.to_string(),
            value,
        });
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
