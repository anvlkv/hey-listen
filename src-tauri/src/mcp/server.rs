//! The local MCP endpoint: a `127.0.0.1` TCP server that speaks MCP.
//!
//! The server binds an ephemeral port, advertises it (with a random token) in
//! [`INFO_FILE`] under the app config dir, and serves one MCP session per
//! connection. Every `tools/call` is forwarded to the **focused project window's**
//! frontend over the `mcp:request` event; the frontend runs the tool against the
//! same stores the UI uses and answers through the `mcp_respond` command. So the
//! agent drives — and observes — the user's live project instead of a headless copy.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::RecvTimeoutError;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::state::WindowRegistry;

use super::{protocol, Pending, INFO_FILE, REQUEST_EVENT, RESPONSE_TIMEOUT};

/// Bind the local MCP endpoint and serve it on a background thread.
///
/// Never fails the app: if the port cannot be bound or advertised, the MCP server
/// is simply unavailable (logged at `warn`) and the app runs normally.
pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(listener) => listener,
        Err(err) => {
            log::warn!("MCP server unavailable (could not bind): {err}");
            return;
        }
    };
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(err) => {
            log::warn!("MCP server unavailable (no local address): {err}");
            return;
        }
    };
    let token = generate_token();
    if let Err(err) = write_info(&app, port, &token) {
        log::warn!("could not advertise the MCP server: {err}");
    }
    log::info!("MCP server listening on 127.0.0.1:{port}");

    let spawned = std::thread::Builder::new()
        .name("mcp-server".into())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let app = app.clone();
                        let token = token.clone();
                        // One thread per connection (an agent holds one session).
                        let _ =
                            std::thread::Builder::new()
                                .name("mcp-conn".into())
                                .spawn(move || {
                                    if let Err(err) = serve(app, stream, token) {
                                        log::debug!("MCP connection ended: {err}");
                                    }
                                });
                    }
                    Err(err) => log::warn!("MCP accept failed: {err}"),
                }
            }
        });
    if let Err(err) = spawned {
        log::warn!("could not start the MCP server thread: {err}");
    }
}

/// Serve one MCP session: validate the token, then handle newline-delimited messages.
fn serve<R: Runtime>(app: AppHandle<R>, stream: TcpStream, token: String) -> std::io::Result<()> {
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
        log::debug!("MCP connection rejected: bad token");
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

/// Forward one tool call to the focused project window and wait for its reply.
fn dispatch<R: Runtime>(app: &AppHandle<R>, tool: &str, arguments: Value) -> Result<Value, String> {
    let label = target_label(app).ok_or_else(|| {
        "no project window is open — run Hey Listen (the app) and try again".to_string()
    })?;

    let pending = app.state::<Pending>();
    if !pending.is_ready(&label) {
        return Err("the project window is still starting up — try again in a moment".to_string());
    }
    let (id, rx) = pending.register();
    let payload = json!({ "id": id, "tool": tool, "arguments": arguments });
    app.emit_to(&label, REQUEST_EVENT, payload)
        .map_err(|err| format!("could not reach the project window: {err}"))?;

    match rx.recv_timeout(RESPONSE_TIMEOUT) {
        Ok(result) => result,
        Err(RecvTimeoutError::Timeout) => {
            Err("the project window did not respond in time".to_string())
        }
        Err(RecvTimeoutError::Disconnected) => {
            Err("the project window could not run the tool".to_string())
        }
    }
}

/// The project window a tool call should drive: the focused window's **root**
/// project window (a focused popout resolves to the project that owns it), else any
/// live project window.
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
    live.into_iter()
        .find(|label| registry.popout_tool(label).is_none())
}

// --- advertisement ---------------------------------------------------------

/// Where the running app advertises its MCP endpoint (also read by the bridge).
pub fn info_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(INFO_FILE))
}

/// Remove the advertisement (called on app exit so a stale file cannot mislead).
pub fn remove_info<R: Runtime>(app: &AppHandle<R>) {
    if let Some(path) = info_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

fn write_info<R: Runtime>(app: &AppHandle<R>, port: u16, token: &str) -> std::io::Result<()> {
    let path = info_path(app)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no app config dir"))?;
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
fn generate_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(u64::from(std::process::id()));
    hasher.write_u128(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0),
    );
    format!("{:016x}{:08x}", hasher.finish(), std::process::id())
}
