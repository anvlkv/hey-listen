//! Shared control flow for the catalog commands (`analyzers`, `nodes`).
//!
//! Each command maps the same request shape — an optional id plus `--json` — onto a
//! list or detail dispatch call, and prints either JSON or a human table/detail. The
//! row and detail formatting stay with the command; only the shared flow lives here.

use std::io::Write;

use serde_json::{json, Value};

use hey_listen_lib::mcp::dispatch::HeadlessSession;

use super::output::emit;

/// The MCP tool names and detail-argument key a catalog command uses.
pub(super) struct CatalogTools {
    pub list: &'static str,
    pub detail: &'static str,
    pub id_key: &'static str,
}

/// How a catalog command renders a list row and a detail object.
pub(super) struct CatalogFormat {
    pub row: fn(&Value) -> String,
    pub detail: fn(&mut dyn Write, &Value) -> std::io::Result<()>,
}

pub(super) fn run_catalog(
    session: &mut HeadlessSession,
    tools: CatalogTools,
    id: Option<&str>,
    json: bool,
    out: &mut dyn Write,
    format: CatalogFormat,
) -> i32 {
    let (tool, args) = match id {
        Some(id) => (tools.detail, json!({ tools.id_key: id })),
        None => (tools.list, json!({})),
    };
    match session.dispatch(tool, args) {
        Ok(Value::Array(items)) => {
            if json {
                emit(out, &Value::Array(items), false);
            } else {
                for item in items {
                    let _ = writeln!(out, "{}", (format.row)(&item));
                }
            }
            0
        }
        Ok(detail) => {
            if json {
                emit(out, &detail, false);
            } else {
                let _ = (format.detail)(out, &detail);
            }
            0
        }
        Err(message) => {
            eprintln!("hey-listen: {message}");
            1
        }
    }
}
