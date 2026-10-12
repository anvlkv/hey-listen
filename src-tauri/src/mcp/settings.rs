//! MCP settings + server lifecycle (the "in-app control" of the MCP follow-up).
//!
//! The persisted settings live in a `tauri-plugin-store` file under the app **data**
//! dir (alongside the `mcp.json` advertisement). [`McpController`] is the single
//! writer: `setup` loads the config and applies it, and the Toolbar popover reads /
//! writes it only through the `get_mcp_status` / `set_mcp_config` commands, so the
//! two never disagree.
//!
//! The server itself is a non-blocking accept loop ([`super::server::accept_loop`])
//! with a shutdown flag, so `set_config` can **stop and rebind** without leaving a
//! stale listener behind.

use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use super::{server, DEFAULT_PORT};

/// The store file (under the app data dir) holding the MCP settings.
const STORE_FILE: &str = "mcp-settings.json";
const KEY_ENABLED: &str = "enabled";
const KEY_PORT: &str = "port";

/// The persisted MCP configuration.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct McpConfig {
    /// Whether the local MCP server is on. Default **off**.
    pub enabled: bool,
    /// The preferred loopback port (default [`DEFAULT_PORT`]); `0` means "any free
    /// port".
    pub port: u16,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
        }
    }
}

/// The observable MCP state, returned to the popover (and the `get_mcp_status`
/// command).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct McpStatus {
    pub enabled: bool,
    /// The **configured** port.
    pub port: u16,
    pub listening: bool,
    /// The port actually bound (may differ from `port` after a free-port fallback).
    pub bound_port: Option<u16>,
    pub error: Option<String>,
    /// A non-fatal note (e.g. "port 47100 is in use — using 47101").
    pub warning: Option<String>,
    /// The app binary that hosts the server (point an MCP client at this + `--mcp`).
    pub app_binary: Option<String>,
    /// The standalone `heylisten-mcp` bridge next to the app binary, when present.
    pub bridge_binary: Option<String>,
}

struct Running {
    port: u16,
    shutdown: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

/// Owns the MCP configuration and the server lifecycle (start / stop / rebind).
///
/// Managed in Tauri state; the popover is a view over it.
#[derive(Default)]
pub struct McpController {
    config: Mutex<McpConfig>,
    running: Mutex<Option<Running>>,
    error: Mutex<Option<String>>,
    warning: Mutex<Option<String>>,
}

impl McpController {
    /// Load the persisted config, apply it (start the server when enabled), and
    /// return the controller. Called once in `setup`.
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        let config = read_config(app);
        let controller = Self::default();
        *lock(&controller.config) = config.clone();
        if config.enabled {
            if let Err(err) = controller.start(app, &config) {
                *lock(&controller.error) = Some(err);
            }
        }
        controller
    }

    /// The current status, for the popover.
    pub fn status<R: Runtime>(&self, app: &AppHandle<R>) -> McpStatus {
        let config = lock(&self.config).clone();
        let running = lock(&self.running);
        let (listening, bound_port) = match running.as_ref() {
            Some(running) => (true, Some(running.port)),
            None => (false, None),
        };
        McpStatus {
            enabled: config.enabled,
            port: config.port,
            listening,
            bound_port,
            error: lock(&self.error).clone(),
            warning: lock(&self.warning).clone(),
            app_binary: std::env::current_exe()
                .ok()
                .map(|path| path.to_string_lossy().into_owned()),
            bridge_binary: server::bridge_binary(app),
        }
    }

    /// Persist a new config and apply it (stop, then start when enabled).
    pub fn set_config<R: Runtime>(&self, app: &AppHandle<R>, config: McpConfig) -> McpStatus {
        *lock(&self.config) = config.clone();
        write_config(app, &config);
        self.stop(app);
        if config.enabled {
            if let Err(err) = self.start(app, &config) {
                *lock(&self.error) = Some(err);
            }
        }
        self.status(app)
    }

    /// Stop the server (and remove the advertisement). Safe to call when stopped.
    pub fn stop<R: Runtime>(&self, app: &AppHandle<R>) {
        let running = lock(&self.running).take();
        if let Some(mut running) = running {
            running.shutdown.store(true, Ordering::Relaxed);
            if let Some(thread) = running.thread.take() {
                let _ = thread.join();
            }
        }
        server::remove_info(app);
    }

    fn start<R: Runtime>(&self, app: &AppHandle<R>, config: &McpConfig) -> Result<(), String> {
        let (listener, warning) = bind(config.port)?;
        let bound = listener
            .local_addr()
            .map(|address| address.port())
            .unwrap_or(0);
        let token = server::generate_token();
        server::write_info(app, bound, &token)
            .map_err(|err| format!("could not advertise the MCP server: {err}"))?;

        let shutdown = Arc::new(AtomicBool::new(false));
        let thread = {
            let app = app.clone();
            let token = token.clone();
            let shutdown = shutdown.clone();
            thread::Builder::new()
                .name("mcp-server".into())
                .spawn(move || server::accept_loop(app, listener, token, shutdown))
                .map_err(|err| format!("could not start the MCP server thread: {err}"))?
        };

        *lock(&self.running) = Some(Running {
            port: bound,
            shutdown,
            thread: Some(thread),
        });
        *lock(&self.error) = None;
        *lock(&self.warning) = warning;
        log::info!("MCP server listening on 127.0.0.1:{bound}");
        Ok(())
    }
}

/// Bind the preferred port, falling back to an ephemeral one when it is already
/// taken (the status carries the note so the popover can show it inline).
fn bind(port: u16) -> Result<(TcpListener, Option<String>), String> {
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => Ok((listener, None)),
        Err(err) if port != 0 => match TcpListener::bind(("127.0.0.1", 0)) {
            Ok(listener) => {
                let bound = listener
                    .local_addr()
                    .map(|address| address.port())
                    .unwrap_or(0);
                Ok((
                    listener,
                    Some(format!("port {port} is in use ({err}); using {bound}")),
                ))
            }
            Err(err) => Err(format!("could not bind a local port: {err}")),
        },
        Err(err) => Err(format!("could not bind port {port}: {err}")),
    }
}

fn read_config<R: Runtime>(app: &AppHandle<R>) -> McpConfig {
    let default = McpConfig::default();
    let Ok(store) = app.store(STORE_FILE) else {
        return default;
    };
    let enabled = store
        .get(KEY_ENABLED)
        .and_then(|value| value.as_bool())
        .unwrap_or(default.enabled);
    let port = store
        .get(KEY_PORT)
        .and_then(|value| value.as_u64())
        .map(|port| port as u16)
        .unwrap_or(default.port);
    McpConfig { enabled, port }
}

fn write_config<R: Runtime>(app: &AppHandle<R>, config: &McpConfig) {
    let Ok(store) = app.store(STORE_FILE) else {
        return;
    };
    store.set(KEY_ENABLED, json!(config.enabled));
    store.set(KEY_PORT, json!(config.port));
    if let Err(err) = store.save() {
        log::warn!("could not persist the MCP settings: {err}");
    }
}

/// Lock a controller mutex, recovering from a poisoned lock.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}
