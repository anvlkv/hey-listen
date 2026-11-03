//! Request mapping: turn parsed `tauri-plugin-cli` matches into a [`Request`], with
//! the shared validation and the `-p` / `-o` / graph-file parsing helpers.

use serde_json::Value;
use tauri_plugin_cli::Matches;

use crate::audio::analysis::canonical_option_key;
use crate::audio::analyzers::{self, AnalyzerId, ToolId};

use super::export_args;
use super::inputs::{
    parse_params, read_annotations, read_filter_graph, read_synth_graph, read_windows, split_kv,
};
use super::types::{AnnotationsOp, BatchCommand, Command, OptionPatch, Request};

mod annotation_args;

/// Whether `name` is a batch subcommand (used to tell a real usage error from a
/// `.heyl` file path that the plugin's parser rejected).
pub fn is_subcommand(name: &str) -> bool {
    name.parse::<BatchCommand>().is_ok()
}

/// Map a matched batch subcommand onto a [`Request`], or a usage-error message.
pub fn build_request(name: &str, matches: &Matches) -> Result<Request, String> {
    let command = name
        .parse::<BatchCommand>()
        .map_err(|_| format!("unknown subcommand: {name}"))?;
    let mut request = common(matches)?;
    match command {
        BatchCommand::Analyzers => {
            request.command = Command::Analyzers {
                id: string(matches, "id"),
                json: flag(matches, "json"),
            };
        }
        BatchCommand::Analyze => {
            request.files = strings(matches, "file");
            request.command = Command::Analyze;
        }
        BatchCommand::Synth => {
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
        BatchCommand::Annotations => {
            let path = string(matches, "file")
                .ok_or("annotations needs a project file: `hey-listen annotations <FILE.heyl>`")?;
            request.command = Command::Annotations {
                path,
                json: flag(matches, "json"),
                full: flag(matches, "full"),
                op: annotation_args::annotation_op(matches)?,
                to: string(matches, "to"),
            };
        }
        BatchCommand::Compare => {
            let a = string(matches, "a").ok_or(
                "compare needs two project files: `hey-listen compare A.heyl B.heyl -t TOOL`",
            )?;
            let b = string(matches, "b").ok_or(
                "compare needs two project files: `hey-listen compare A.heyl B.heyl -t TOOL`",
            )?;
            request.command = Command::Compare {
                a,
                b,
                save: string(matches, "save"),
                open_tools: tool_ids(matches, "open-tool")?,
            };
        }
        BatchCommand::Project => {
            let path = string(matches, "dest").ok_or(
                "project needs an output path: `hey-listen project <OUT.heyl> --source <FILE>`",
            )?;
            let source = string(matches, "source");
            let synth = match string(matches, "synth") {
                Some(graph_path) => {
                    let graph = read_synth_graph(&graph_path)?;
                    let seconds = match string(matches, "seconds") {
                        Some(text) => text
                            .parse::<f64>()
                            .map_err(|_| format!("invalid --seconds: {text}"))?,
                        None => 5.0,
                    };
                    Some((graph, seconds))
                }
                None => None,
            };
            let annotations = match string(matches, "annotations") {
                Some(path) => read_annotations(&path)?,
                None => Vec::new(),
            };
            request.command = Command::ProjectSave {
                path,
                source,
                synth,
                name: string(matches, "name"),
                open_tools: tool_ids(matches, "open-tool")?,
                annotations,
                reference: flag(matches, "reference"),
            };
        }
    }
    validate(&request)?;
    Ok(request)
}

/// Parse the options shared by `analyze` and `synth` (everything but the command).
fn common(matches: &Matches) -> Result<Request, String> {
    let tools = request_tools(matches)?;
    let request = Request {
        command: Command::Analyze,
        files: Vec::new(),
        tools: tools.clone(),
        all: flag(matches, "all"),
        start: optional_number(matches, "start")?,
        end: optional_number(matches, "end")?,
        a_start: optional_number(matches, "a-start")?,
        a_end: optional_number(matches, "a-end")?,
        b_start: optional_number(matches, "b-start")?,
        b_end: optional_number(matches, "b-end")?,
        overlap: flag(matches, "overlap"),
        b_offset: optional_number(matches, "b-offset")?.unwrap_or(0.0),
        windows: match string(matches, "windows") {
            Some(path) => read_windows(&path)?,
            None => Vec::new(),
        },
        params: parse_params(&strings(matches, "param"))?,
        options: parse_option_patches(&strings(matches, "option"), &tools)?,
        filter: match string(matches, "filter") {
            Some(path) => Some(read_filter_graph(&path)?),
            None => None,
        },
        full: flag(matches, "full"),
        summary: flag(matches, "summary"),
        format: export_args::parse_format(matches)?,
        out: string(matches, "out").map(export_args::output_target),
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
            if !request.windows.is_empty() && (request.start.is_some() || request.end.is_some()) {
                return Err("use either `--windows FILE` or `--start`/`--end`, not both".into());
            }
            let needs_tools = request.windows.is_empty()
                || request.windows.iter().any(|window| window.tools.is_empty());
            if needs_tools && request.tools.is_empty() && !request.all {
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
        Command::Annotations {
            op, to, json, full, ..
        } => {
            let mutating = matches!(
                op,
                AnnotationsOp::Add { .. }
                    | AnnotationsOp::Update { .. }
                    | AnnotationsOp::Delete { .. }
            );
            if to.is_some() && !mutating {
                return Err(
                    "`--to` writes a changed project; use it with --add / --update / --delete"
                        .into(),
                );
            }
            if mutating && (*json || *full) {
                return Err(
                    "`--json` / `--full` list the annotations; a mutation prints one JSON record"
                        .into(),
                );
            }
        }
        Command::Compare {
            save, open_tools, ..
        } => {
            if request.tools.is_empty() && !request.all {
                return Err("compare needs `-t <TOOL>` (or `--all`)".into());
            }
            if !request.windows.is_empty() {
                return Err("compare does not take `--windows`; use --start/--end".into());
            }
            if save.is_none() && !open_tools.is_empty() {
                return Err("--open-tool applies when --save writes the project".into());
            }
        }
        Command::ProjectSave {
            source,
            synth,
            reference,
            ..
        } => match (source, synth) {
            (Some(_), Some(_)) => {
                return Err(
                    "use either `--source <AUDIO>` or `--synth <GRAPH.json>`, not both".into(),
                )
            }
            (None, None) => {
                return Err(
                    "project needs a source: `--source <AUDIO>` or `--synth <GRAPH.json>`".into(),
                )
            }
            (_, Some((_, seconds))) => {
                if !seconds.is_finite() || *seconds <= 0.0 {
                    return Err(format!(
                        "--seconds must be a positive number, got {seconds}"
                    ));
                }
                if *reference {
                    return Err(
                        "--reference needs a file source (a synth cannot be re-decoded)".into(),
                    );
                }
            }
            (Some(_), None) => {}
        },
    }
    if request.pretty && result_count(request) != 1 {
        return Err("--pretty prints a single result; give exactly one file and one tool".into());
    }
    if request.summary && request.full {
        return Err("--summary and --full are mutually exclusive".into());
    }
    export_args::validate(request)
}

/// How many result lines a request produces (for the `--pretty` check).
pub(super) fn result_count(request: &Request) -> usize {
    match &request.command {
        Command::Analyzers { .. } => 0,
        Command::Analyze => request.files.len() * window_result_count(request),
        Command::Synth { .. } => tool_count(request),
        Command::Annotations { .. } => 0,
        Command::Compare { .. } => tool_count(request),
        Command::ProjectSave { .. } => 1,
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

/// The result lines one file produces: the sum over `--windows`, each falling back to
/// the request's tool list when the line names none.
fn window_result_count(request: &Request) -> usize {
    if request.windows.is_empty() {
        return tool_count(request);
    }
    request
        .windows
        .iter()
        .map(|window| {
            if window.tools.is_empty() {
                tool_count(request)
            } else {
                window.tools.len()
            }
        })
        .sum()
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

pub(super) fn string(matches: &Matches, name: &str) -> Option<String> {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_str())
        .map(str::to_string)
}

/// A repeatable Workbench tool id (`--open-tool`), parsed once here.
fn tool_ids(matches: &Matches, name: &str) -> Result<Vec<ToolId>, String> {
    strings(matches, name)
        .into_iter()
        .map(|id| {
            id.parse::<ToolId>()
                .map_err(|_| format!("unknown tool in --{name}: {id}"))
        })
        .collect()
}

pub(super) fn flag(matches: &Matches, name: &str) -> bool {
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

/// Parse `-o` patches. A token is `[TOOL.]KEY=VALUE`; a bare `KEY=VALUE` is scoped to
/// the sole `--tool` (there is no other way to tell which tool it belongs to, since the
/// plugin's matches do not preserve the order of flags on the command line).
fn request_tools(matches: &Matches) -> Result<Vec<AnalyzerId>, String> {
    strings(matches, "tool")
        .iter()
        .map(|tool| {
            tool.parse()
                .map_err(|_| format!("unknown analyzer: {tool}"))
        })
        .collect()
}

fn parse_option_patches(
    tokens: &[String],
    tools: &[AnalyzerId],
) -> Result<Vec<OptionPatch>, String> {
    let mut patches = Vec::new();
    for token in tokens {
        let (lhs, value) = split_kv(token)?;
        let (tool, key) = match lhs.split_once('.') {
            Some((tool, key)) => (
                tool.parse::<AnalyzerId>()
                    .map_err(|_| format!("unknown analyzer in `-o`: {tool}"))?,
                key.to_string(),
            ),
            None if tools.len() == 1 => (tools[0], lhs),
            None => {
                return Err(format!(
                    "`-o {token}` must name its tool: use `-o <TOOL>.<KEY>=<VALUE>`"
                ))
            }
        };
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
