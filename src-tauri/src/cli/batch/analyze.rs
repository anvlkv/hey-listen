//! `analyze` — decode each file in turn and run the requested tools over it.

use std::io::Write;

use serde_json::json;

use crate::audio::analyzers;
use crate::mcp::dispatch::HeadlessSession;

use super::output::emit;
use super::types::Request;

/// Decode each file in turn and run the requested tools over it (over each `--windows`
/// entry when a window list was given).
pub(super) fn run_analyze(
    session: &mut HeadlessSession,
    request: &Request,
    out: &mut impl Write,
) -> i32 {
    let tools = tools_for(request);
    let windows = resolve_windows(request, &tools);
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
        for (start, end, window_tools) in &windows {
            if run_tools(session, request, window_tools, file, *start, *end, out).is_err() {
                failed = true;
                if request.fail_fast {
                    return 1;
                }
            }
        }
    }
    if failed {
        1
    } else {
        0
    }
}

/// The windows to run: the explicit `--start`/`--end` single window, or each
/// `--windows` line (falling back to the request's tool list when a line names none).
/// An absent bound keeps the session's current window bound.
fn resolve_windows(
    request: &Request,
    tools: &[String],
) -> Vec<(Option<f64>, Option<f64>, Vec<String>)> {
    if request.windows.is_empty() {
        return vec![(request.start, request.end, tools.to_vec())];
    }
    request
        .windows
        .iter()
        .map(|window| {
            (
                Some(window.start),
                Some(window.end),
                if window.tools.is_empty() {
                    tools.to_vec()
                } else {
                    window.tools.clone()
                },
            )
        })
        .collect()
}

/// The tool ids to run: the catalog when `--all`, else the requested `-t` ids.
pub(super) fn tools_for(request: &Request) -> Vec<String> {
    if request.all {
        analyzers::ANALYZERS
            .iter()
            .map(|analyzer| analyzer.id.to_string())
            .collect()
    } else {
        request.tools.clone()
    }
}

/// Run every tool over the session's current source and window, emitting one line per
/// tool.
///
/// Returns `Ok(())` when all tools succeeded, `Err(())` when at least one failed
/// (short-circuiting on the first failure when `--fail-fast` is set).
pub(super) fn run_tools(
    session: &mut HeadlessSession,
    request: &Request,
    tools: &[String],
    label: &str,
    start: Option<f64>,
    end: Option<f64>,
    out: &mut impl Write,
) -> Result<(), ()> {
    let mut failed = false;
    for tool in tools {
        let mut args = json!({ "tool": tool });
        if let Some(start) = start {
            args["start"] = json!(start);
        }
        if let Some(end) = end {
            args["end"] = json!(end);
        }
        if request.full {
            args["includeData"] = json!(true);
        }
        if request.summary {
            args["summaryOnly"] = json!(true);
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
