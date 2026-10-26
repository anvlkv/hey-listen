//! The local MCP endpoint: a `127.0.0.1` TCP server that speaks MCP.
//!
//! The server binds a loopback port and advertises it (with a random token) in
//! [`INFO_FILE`] under the app **data** dir, then serves one MCP session per
//! connection. Every `tools/call` is forwarded to a **project window's** frontend
//! over the `mcp:request` event; the frontend runs the tool against the same stores
//! the UI uses and answers through the `mcp_respond` command. So the agent drives —
//! and observes — the user's live project instead of a headless copy.
//!
//! Lifecycle (start/stop/rebind) is owned by [`super::settings::McpController`]; this
//! module provides the transport plus the routing helpers:
//!
//! - `list_projects` is answered here (the server knows every project window);
//! - every other tool takes an optional `target` label to pick a specific window,
//!   defaulting to the focused one.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::state::WindowRegistry;

use super::{protocol, Pending, INFO_FILE, REQUEST_EVENT, RESPONSE_TIMEOUT};

/// Serve the endpoint until `shutdown` is set.
///
/// The listener is **blocking**: the thread parks in `accept()` and the kernel wakes it
/// as soon as a connection is queued. That matters because the app is usually *in the
/// background* while it serves (the agent drives it from another window) — macOS
/// coalesces the timers of a background app, so a poll-and-sleep loop can leave
/// connections sitting unaccepted in the backlog for seconds, which looks exactly like a
/// hung server. [`super::settings::McpController::stop`] interrupts the parked call with
/// a loopback connection.
///
/// Each accepted connection gets its own thread (an agent holds one session); those
/// threads are detached and end when their socket closes.
pub fn accept_loop<R: Runtime>(
    app: AppHandle<R>,
    listener: TcpListener,
    token: String,
    shutdown: Arc<AtomicBool>,
) {
    // Guard the assumption below: a non-blocking listener would turn this into a spin.
    if let Err(err) = listener.set_nonblocking(false) {
        log::warn!("MCP server unavailable (could not go blocking): {err}");
        return;
    }
    loop {
        let stream = match listener.accept() {
            Ok((stream, _)) => stream,
            // A signal can interrupt the parked call; retry instead of tearing down.
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(err) => {
                log::warn!("MCP accept failed: {err}");
                break;
            }
        };
        // `stop()` sets the flag and *then* wakes us with a loopback connection, which
        // arrives here carrying nothing: drop it and exit rather than spawn a session.
        if shutdown.load(Ordering::SeqCst) {
            break;
        }
        log::info!("MCP connection accepted");
        let app = app.clone();
        let token = token.clone();
        let _ = std::thread::Builder::new()
            .name("mcp-conn".into())
            .spawn(move || {
                if let Err(err) = serve(app, stream, token) {
                    log::debug!("MCP connection ended: {err}");
                }
            });
    }
}

/// Serve one MCP session: validate the token, then handle newline-delimited messages.
fn serve<R: Runtime>(app: AppHandle<R>, stream: TcpStream, token: String) -> std::io::Result<()> {
    // The listener is blocking, so this normally already holds — say it explicitly so a
    // future change to the listener's mode cannot turn `read_line` into `WouldBlock`.
    stream.set_nonblocking(false)?;
    stream.set_nodelay(true)?;
    let reader_stream = stream.try_clone()?;
    let mut reader = BufReader::new(reader_stream);
    let mut writer = stream;

    // Handshake: the first line is the token the bridge read from `mcp.json`.
    let mut hello = String::new();
    if reader.read_line(&mut hello)? == 0 {
        return Ok(());
    }
    if hello.trim() != token {
        log::warn!("MCP connection rejected: bad token (stale mcp.json?)");
        return Ok(());
    }

    let mut dispatch = |tool: &str, arguments: Value| dispatch(&app, tool, arguments);
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break; // the bridge/agent closed the session
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(response) = protocol::handle_message(trimmed, &mut dispatch) {
            let mut bytes = serde_json::to_vec(&response)?;
            bytes.push(b'\n');
            writer.write_all(&bytes)?;
            writer.flush()?;
        }
    }
    Ok(())
}

/// Route one tool call to the target project window and wait for its reply.
///
/// `list_projects` is answered by the server itself; every other tool carries an
/// optional `target` (a label from `list_projects`) selecting which project window
/// to drive. The target is stripped from the arguments before forwarding (the
/// frontend handlers do not know about it) and passed alongside as `target`.
fn dispatch<R: Runtime>(
    app: &AppHandle<R>,
    tool: &str,
    mut arguments: Value,
) -> Result<Value, String> {
    // The server owns the window inventory, so it answers `list_projects` directly.
    if tool == "list_projects" {
        return Ok(json!({ "projects": list_projects(app) }));
    }

    // An optional `target` picks a project window other than the focused one.
    let requested = arguments
        .get("target")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(object) = arguments.as_object_mut() {
        object.remove("target");
    }
    let label = match requested {
        Some(requested) => resolve_target(app, &requested)?,
        None => target_label(app).ok_or_else(|| {
            "no project window is open — run Hey Listen (the app) and try again".to_string()
        })?,
    };

    let pending = app.state::<Pending>();
    if !pending.is_ready(&label) {
        return Err("the project window is still starting up — try again in a moment".to_string());
    }
    let (id, rx) = pending.register();
    let payload = json!({ "id": id, "tool": tool, "arguments": arguments, "target": label });
    app.emit_to(&label, REQUEST_EVENT, payload)
        .map_err(|err| format!("could not reach the project window: {err}"))?;

    match rx.recv_timeout(RESPONSE_TIMEOUT) {
        Ok(result) => result.map(|result| with_server_info(tool, result)),
        Err(RecvTimeoutError::Timeout) => {
            Err("the project window did not respond in time".to_string())
        }
        Err(RecvTimeoutError::Disconnected) => {
            Err("the project window could not run the tool".to_string())
        }
    }
}

/// Stamp `get_state` with the server's mode and version, so an agent can tell a stale
/// app from the build it expects without reading `mcp.json` or the log preamble.
fn with_server_info(tool: &str, result: Value) -> Value {
    if tool != "get_state" {
        return result;
    }
    let mut result = result;
    if let Value::Object(object) = &mut result {
        object.insert(
            "server".to_string(),
            json!({ "mode": "bridge", "version": env!("CARGO_PKG_VERSION") }),
        );
    }
    result
}

/// The project window a tool call should drive by default: the focused window's
/// **root** project window (a focused popout resolves to the project that owns it),
/// else any live project window.
fn target_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let registry = app.state::<WindowRegistry>();
    let live: Vec<String> = app.webview_windows().keys().cloned().collect();

    // The focused window's root, when that root is a live window.
    if let Some(focused) = crate::commands::focused_label(app) {
        let root = registry.root_label(&focused);
        if live.iter().any(|label| label == &root) {
            return Some(root);
        }
    }
    // Otherwise, the first live window that is not a popout.
    live.into_iter().find(|label| !registry.is_popout(label))
}

/// Resolve an explicit `target` label to the project window it names.
///
/// A popout label resolves to its owning project window (a tool call never lands in
/// a single-tool popout). Unknown labels fail with a hint to call `list_projects`.
fn resolve_target<R: Runtime>(app: &AppHandle<R>, requested: &str) -> Result<String, String> {
    let registry = app.state::<WindowRegistry>();
    let live: Vec<String> = app.webview_windows().keys().cloned().collect();
    let root = registry.root_label(requested);
    if live.iter().any(|label| label == &root) {
        Ok(root)
    } else {
        Err(format!(
            "no project window '{requested}' — call list_projects for the labels"
        ))
    }
}

/// Every project window in the process: one entry per **project** (a popout is a view
/// of its project, not a project of its own). Each carries its label, its display
/// name (from the shared UI state), and whether it is the focused project.
fn list_projects<R: Runtime>(app: &AppHandle<R>) -> Vec<Value> {
    let registry = app.state::<WindowRegistry>();
    let focused = crate::commands::focused_label(app).map(|label| registry.root_label(&label));

    let mut labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    labels.retain(|label| !registry.is_popout(label));
    labels.sort();

    labels
        .into_iter()
        .map(|label| {
            let name = registry
                .get(&label)
                .ui_snapshot()
                .get("project")
                .and_then(|value| value.get("name"))
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
                .unwrap_or(&label)
                .to_string();
            json!({
                "label": label,
                "name": name,
                "focused": focused.as_deref() == Some(label.as_str()),
            })
        })
        .collect()
}

// --- advertisement ---------------------------------------------------------

/// Where the running app advertises its MCP endpoint (also read by the bridge).
///
/// The **data** dir (not the config dir) so the advertisement sits with the
/// `tauri-plugin-store` settings file; on macOS the two resolve to the same path.
pub fn info_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(INFO_FILE))
}

/// Remove the advertisement (called when the server stops / the app exits, so a
/// stale file cannot mislead the bridge).
pub fn remove_info<R: Runtime>(app: &AppHandle<R>) {
    if let Some(path) = info_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

/// Write the current endpoint advertisement.
pub fn write_info<R: Runtime>(app: &AppHandle<R>, port: u16, token: &str) -> std::io::Result<()> {
    let path = info_path(app)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no app data dir"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let info = json!({
        "port": port,
        "token": token,
        "pid": std::process::id(),
        "version": env!("CARGO_PKG_VERSION"),
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&info)?)
}

/// A random-ish token so another local process cannot drive the app.
pub fn generate_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(u64::from(std::process::id()));
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0),
    );
    format!("{:016x}{:08x}", hasher.finish(), std::process::id())
}

/// The standalone `heylisten-mcp` bridge next to the app binary, when it exists (the
/// binary is built alongside the app, not shipped inside the bundle).
pub fn bridge_binary<R: Runtime>(_app: &AppHandle<R>) -> Option<String> {
    let current = std::env::current_exe().ok()?;
    let name = if cfg!(windows) {
        "heylisten-mcp.exe"
    } else {
        "heylisten-mcp"
    };
    let candidate = current.parent()?.join(name);
    candidate
        .exists()
        .then(|| candidate.to_string_lossy().into_owned())
}
