//! JSON-RPC 2.0 framing and the MCP method surface.
//!
//! Pure and transport-free: [`handle_message`] takes one newline-delimited message
//! and returns the response (or `None` for a notification), delegating `tools/call`
//! to a caller-supplied dispatcher. That keeps the protocol testable without a
//! running app, and keeps the Tauri-specific forwarding in [`super::server`].

use serde_json::{json, Value};

use super::tools;
use super::PROTOCOL_VERSION;

// JSON-RPC 2.0 error codes.
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

/// Handle one newline-delimited JSON-RPC message.
///
/// Returns the response object to write back, or `None` when the message is a
/// notification (which must not be answered).
pub fn handle_message(
    line: &str,
    dispatch: &mut dyn FnMut(&str, Value) -> Result<Value, String>,
) -> Option<Value> {
    let message: Value = match serde_json::from_str(line) {
        Ok(message) => message,
        Err(err) => {
            return Some(error_response(
                Value::Null,
                PARSE_ERROR,
                &format!("parse error: {err}"),
            ))
        }
    };

    let Some(object) = message.as_object() else {
        return Some(error_response(
            Value::Null,
            INVALID_REQUEST,
            "expected a JSON-RPC object",
        ));
    };

    // A message without `method` is a response/notification we do not expect.
    let method = object.get("method").and_then(Value::as_str)?;

    // A message without `id` is a notification: handle silently, never answer.
    if !object.contains_key("id") {
        return None;
    }
    let id = object.get("id").cloned().unwrap_or(Value::Null);
    let params = object.get("params").cloned().unwrap_or(Value::Null);

    match dispatch_method(method, &params, dispatch) {
        Ok(result) => Some(success_response(id, result)),
        Err((code, message)) => Some(error_response(id, code, &message)),
    }
}

/// Route one request to its handler.
fn dispatch_method(
    method: &str,
    params: &Value,
    dispatch: &mut dyn FnMut(&str, Value) -> Result<Value, String>,
) -> Result<Value, (i64, String)> {
    match method {
        "initialize" => Ok(initialize_result(params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::list() })),
        "tools/call" => call_tool(params, dispatch),
        // We advertise neither resources nor prompts; answer emptily for clients
        // that probe them anyway.
        "resources/list" => Ok(json!({ "resources": [] })),
        "resources/templates/list" => Ok(json!({ "resourceTemplates": [] })),
        "prompts/list" => Ok(json!({ "prompts": [] })),
        other => Err((METHOD_NOT_FOUND, format!("method not found: {other}"))),
    }
}

/// The `initialize` result: echo the client's protocol revision and advertise tools.
fn initialize_result(params: &Value) -> Value {
    let requested = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .filter(|version| !version.is_empty())
        .unwrap_or(PROTOCOL_VERSION);
    json!({
        "protocolVersion": requested,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": {
            "name": "hey-listen",
            "title": "Hey Listen",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "instructions": "Drive the running Hey Listen project: open a source, run analysis \
                         tools, edit the filter/synth graphs, preview playback, and save/load \
                         projects. Call `get_state` first to see the current source, analysis \
                         window, shared params, and open Workbench tabs; call `list_projects` \
                         to target a specific project window. When no app is running this \
                         server runs headless and serves the compute tools (open a source, \
                         run analyzers, render synth).",
    })
}

/// `tools/call`: run the requested tool and wrap its result (or error) as MCP content.
///
/// A tool failure is returned as a *successful* `CallToolResult` with `isError`, so
/// the agent sees the message in the conversation instead of a transport error.
fn call_tool(
    params: &Value,
    dispatch: &mut dyn FnMut(&str, Value) -> Result<Value, String>,
) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or((INVALID_PARAMS, "tools/call requires a `name`".to_string()))?;
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    match dispatch(&name, arguments) {
        Ok(value) => Ok(call_result(value, false)),
        Err(message) => Ok(call_result(Value::String(message), true)),
    }
}

/// Shape a tool's return value as a `CallToolResult`.
///
/// Objects also carry `structuredContent` (the 2025-06-18 revision) alongside the
/// human-readable text, so newer clients can read the typed payload directly.
fn call_result(value: Value, is_error: bool) -> Value {
    let text = match &value {
        Value::String(text) => text.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
    };
    let mut result = json!({
        "content": [ { "type": "text", "text": text } ],
        "isError": is_error,
    });
    if !is_error {
        if let Value::Object(object) = value {
            result["structuredContent"] = Value::Object(object);
        }
    }
    result
}

fn success_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A dispatcher that echoes its arguments back, so tests can observe forwarding.
    fn echo(tool: &str, arguments: Value) -> Result<Value, String> {
        if tool == "boom" {
            return Err("something went wrong".to_string());
        }
        Ok(json!({ "tool": tool, "arguments": arguments }))
    }

    fn call(message: Value) -> Value {
        let line = message.to_string();
        handle_message(&line, &mut echo).expect("expected a response")
    }

    #[test]
    fn initialize_echoes_the_requested_protocol_version() {
        let response = call(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {} },
        }));
        assert_eq!(response["id"], 1);
        assert_eq!(response["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(response["result"]["serverInfo"]["name"], "hey-listen");
        assert!(response["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn initialize_falls_back_without_a_requested_version() {
        let response = call(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }));
        assert_eq!(response["result"]["protocolVersion"], PROTOCOL_VERSION);
    }

    #[test]
    fn tools_list_exposes_the_catalog() {
        let response = call(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }));
        let names: Vec<&str> = response["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"get_state"));
        assert!(names.contains(&"run_analysis"));
        assert!(names.contains(&"set_filter_graph"));
        // Every tool carries a description and an input schema.
        for tool in response["result"]["tools"].as_array().unwrap() {
            assert!(tool["description"].as_str().is_some_and(|d| !d.is_empty()));
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
    }

    #[test]
    fn tools_call_forwards_arguments_and_wraps_the_result() {
        let response = call(json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "open_audio_file", "arguments": { "path": "/tmp/a.wav" } },
        }));
        assert_eq!(response["result"]["isError"], false);
        assert_eq!(
            response["result"]["structuredContent"]["arguments"]["path"],
            "/tmp/a.wav"
        );
        assert_eq!(response["result"]["content"][0]["type"], "text");
    }

    #[test]
    fn tools_call_reports_a_failure_as_an_error_result() {
        let response = call(json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": { "name": "boom", "arguments": {} },
        }));
        assert_eq!(response["result"]["isError"], true);
        assert_eq!(
            response["result"]["content"][0]["text"],
            "something went wrong"
        );
    }

    #[test]
    fn tools_call_requires_a_name() {
        let response = call(json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call" }));
        assert_eq!(response["error"]["code"], INVALID_PARAMS);
    }

    #[test]
    fn notifications_are_not_answered() {
        assert!(handle_message(
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
            &mut echo,
        )
        .is_none());
    }

    #[test]
    fn ping_returns_an_empty_result() {
        let response = call(json!({ "jsonrpc": "2.0", "id": 6, "method": "ping" }));
        assert_eq!(response["result"], json!({}));
    }

    #[test]
    fn unknown_methods_are_rejected() {
        let response = call(json!({ "jsonrpc": "2.0", "id": 7, "method": "nope" }));
        assert_eq!(response["error"]["code"], METHOD_NOT_FOUND);
    }

    #[test]
    fn invalid_json_is_a_parse_error() {
        let response = handle_message("{not json", &mut echo).unwrap();
        assert_eq!(response["error"]["code"], PARSE_ERROR);
        assert_eq!(response["id"], Value::Null);
    }
}
