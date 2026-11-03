//! `project` — build a `.heyl` project from a source + setup + tabs, windowless.
//!
//! This is the CLI face of the headless MCP `open_audio_file` / `render_synth` →
//! `set_*` → `open_tool` → `save_project` sequence: it drives the same session, so a
//! project written here opens in the app with the same source, setup, filter, annotations
//! and Workbench tabs. Nothing is analyzed unless asked for separately.

use std::io::Write;

use serde_json::{json, Value};

use crate::mcp::dispatch::HeadlessSession;

use super::output::emit;
use super::types::{Command, Request};

/// Run `project <OUT.heyl>`: install the source, apply the shared setup (already done
/// by the dispatcher), open the requested tabs, and save.
pub(super) fn run_project_save(
    session: &mut HeadlessSession,
    request: &Request,
    out: &mut impl Write,
) -> i32 {
    let Command::ProjectSave {
        path,
        source,
        synth,
        name,
        open_tools,
        annotations,
        reference,
    } = &request.command
    else {
        return 2;
    };

    let summary = match open_source(session, source.as_deref(), synth.as_ref()) {
        Ok(summary) => summary,
        Err(message) => return fail(out, &message),
    };
    let duration = summary
        .get("duration")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    // An explicit end defaults to the whole source; an explicit start alone runs to it.
    if request.start.is_some() || request.end.is_some() {
        let start = request.start.unwrap_or(0.0);
        let end = request.end.unwrap_or(duration);
        if let Err(message) =
            session.dispatch("set_analysis_window", json!({ "start": start, "end": end }))
        {
            return fail(out, &message);
        }
    }

    for tool in open_tools {
        if let Err(message) = session.dispatch("open_tool", json!({ "tool": tool })) {
            return fail(out, &message);
        }
    }

    let saved = match session.dispatch(
        "save_project",
        json!({
            "path": path,
            "name": name,
            "openTools": open_tools,
            "annotations": Value::Array(annotations.clone()),
            "embedSource": !reference,
        }),
    ) {
        Ok(saved) => saved,
        Err(message) => return fail(out, &message),
    };

    let mut value = saved;
    value["openTools"] = json!(open_tools);
    emit(out, &value, request.pretty);
    0
}

/// Install the requested source; returns its summary (so the caller can clamp windows).
fn open_source(
    session: &mut HeadlessSession,
    source: Option<&str>,
    synth: Option<&(crate::audio::graph::GraphSpec, f64)>,
) -> Result<Value, String> {
    match (source, synth) {
        (Some(file), _) => {
            session.dispatch("open_audio_file", json!({ "path": file, "replace": true }))
        }
        (_, Some((graph, seconds))) => {
            let graph = serde_json::to_value(graph).map_err(|err| err.to_string())?;
            session.dispatch(
                "render_synth",
                json!({ "graph": graph, "seconds": seconds }),
            )
        }
        (None, None) => Err("project needs a source".to_string()),
    }
}

/// Emit an error line and return the failure exit code (runtime, not usage).
fn fail(out: &mut impl Write, message: &str) -> i32 {
    emit(out, &json!({ "error": message }), false);
    1
}
