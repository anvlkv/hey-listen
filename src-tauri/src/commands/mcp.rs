//! MCP tool-call forwarding (M9).
//!
//! The MCP server forwards each `tools/call` to a project window's frontend
//! (`mcp:request`); the window confirms receipt (`mcp_ack`) and then answers with the
//! result or its error (`mcp_respond`). See [`crate::mcp`] and.

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::mcp::settings::{McpConfig, McpController, McpStatus};
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

/// Confirm that the calling window received forwarded MCP tool call `id`.
///
/// The frontend sends this the moment its `mcp:request` handler runs, before it starts
/// the tool. The server cannot tell on its own whether an emit reached a listener
/// (`emit_to` is fire-and-forget), so without this it would hold a call for the whole
/// response timeout while a cold-starting window — or a client that already gave up —
/// waited on nothing. A late acknowledgement (the call already failed fast) is ignored.
#[tauri::command]
pub fn mcp_ack(app: AppHandle, id: u64) {
    app.state::<Pending>().acknowledge(id);
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

/// The MCP server status (enabled, port, listening, and the copyable endpoints).
#[tauri::command]
pub fn get_mcp_status(app: AppHandle) -> McpStatus {
    app.state::<McpController>().status(&app)
}

/// Persist the MCP config (on/off + port) and apply it (start / stop / rebind),
/// returning the resulting status.
///
/// Asynchronous on purpose: `McpController::stop` **joins** the accept-loop thread,
/// and a synchronous command runs on the main thread — joining there can freeze the
/// whole app (the same rule as capture start/stop; see `commands/capture.rs`).
#[tauri::command]
pub async fn set_mcp_config(app: AppHandle, config: McpConfig) -> McpStatus {
    app.state::<McpController>().set_config(&app, config)
}
