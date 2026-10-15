//! `synth` — render a synth graph, then analyze it (or report the rendered source).

use std::io::Write;

use serde_json::{json, Value};

use crate::audio::graph::GraphSpec;
use crate::mcp::dispatch::HeadlessSession;

use super::analyze::{run_tools, tools_for};
use super::output::emit;
use super::types::Request;

/// Render `graph` for `seconds` on the session, then analyze the rendered source with
/// the requested tools (or emit the source summary when no tool was given).
pub(super) fn run_synth(
    session: &mut HeadlessSession,
    request: &Request,
    graph: &GraphSpec,
    seconds: f64,
    path: &str,
    out: &mut impl Write,
) -> i32 {
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
    if run_tools(session, request, &tools, path, out).is_err() {
        return 1;
    }
    0
}
