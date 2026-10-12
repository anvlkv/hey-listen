//! MCP tool-call replies (M9).
//!
//! The MCP server forwards each `tools/call` to a project window's frontend
//! (`mcp:request`) and blocks until the frontend runs the tool and answers through
//! this command. See [`crate::mcp`] and `docs/mcp.md`.

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::mcp::Pending;

/// Mark the calling window's frontend as ready to receive MCP tool calls.
///
/// The frontend calls this once its `mcp:request` listener is registered; until
/// then the server fails forwarded calls fast instead of waiting for a reply.
#[tauri::command]
pub fn mcp_ready(window: WebviewWindow) {
    window
        .app_handle()
        .state::<Pending>()
        .mark_ready(window.label());
}

/// Complete a forwarded MCP tool call with its result (`ok: true`) or message.
#[tauri::command]
pub fn mcp_respond(
    app: AppHandle,
    id: u64,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
) {
    let outcome = if ok {
        Ok(result.unwrap_or(Value::Null))
    } else {
        Err(error.unwrap_or_else(|| "the tool failed".to_string()))
    };
    app.state::<Pending>().resolve(id, outcome);
}
