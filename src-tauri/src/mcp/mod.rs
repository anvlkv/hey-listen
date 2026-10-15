//! MCP server (M9) — expose Hey Listen to AI agents.
//!
//! A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an
//! agent drive the app: open a source, run every analysis tool, edit the filter /
//! synth graphs, preview playback, and save/load projects — then observe what the
//! user's live window is showing. This is the *same* surface the UI drives, not a
//! parallel one: the core owns the protocol and the transport, and forwards every
//! tool call to the focused project window's frontend, which runs it through the
//! exact stores and commands the UI uses. So an agent action is reflected in the
//! window, and a user action is visible to the agent.
//!
//! ## Shape
//!
//! ```text
//!  agent (MCP client)       heylisten-mcp            Hey Listen (core + webview)
//!  ┌──────────┐  stdio MCP  ┌──────────────┐  TCP   ┌──────────────────────────┐
//!  │  client  │ ──────────► │    bridge    │ ─────► │ mcp::server (localhost)  │
//!  └──────────┘ ◄────────── └──────────────┘ ◄───── └───────────┬──────────────┘
//!                                                               │ mcp:request event
//!                                                               ▼
//!                                                      window frontend (state/mcp/)
//!                                                               │ mcp_respond
//!                                                               ▼
//! ```
//!
//! The server binds an ephemeral `127.0.0.1` port and advertises it (with a random
//! token) in `mcp.json` under the app **data** dir. The `heylisten-mcp` bridge is a
//! dumb byte pump between stdio and that socket, so the MCP protocol lives in one
//! place (the app) and an agent always talks to the *running* project.
//!
//! See [`docs/mcp.md`](../../../docs/mcp.md).

pub mod bridge;
pub mod dispatch;
pub mod headless;
pub mod protocol;
pub mod server;
pub mod settings;
pub mod tools;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::Value;

/// Event the core emits to a project window's frontend to run one MCP tool.
pub const REQUEST_EVENT: &str = "mcp:request";

/// File (in the app **data** dir) advertising the local server's port + token.
pub const INFO_FILE: &str = "mcp.json";

/// Fallback protocol version when the client does not request one we recognise.
/// The server echoes the client's requested version when it is present, so newer
/// clients negotiate their own revision.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// How long a forwarded tool call waits for the window to answer.
pub const RESPONSE_TIMEOUT: Duration = Duration::from_secs(120);

/// The default loopback port for the local MCP server (the popover shows / edits it).
pub const DEFAULT_PORT: u16 = 47100;

/// How long the stdio entry waits for a running app to advertise itself before
/// falling back to the headless server. Kept short so `heylisten-mcp` used as a
/// GUI-less CLI starts promptly; a running, MCP-enabled app writes `mcp.json` in
/// `setup`, so it is present almost immediately.
const DISCOVER_GRACE: Duration = Duration::from_millis(1200);

/// The MCP **stdio entry** shared by `hey-listen --mcp` and `heylisten-mcp`.
///
/// Auto-detects: when a running, MCP-enabled app is advertising its endpoint, it
/// **bridges** to it (UI following, as delivered); otherwise it runs the
/// **core-native headless** server. `force_headless` (`--headless`) skips the probe.
pub fn run(force_headless: bool) -> std::io::Result<()> {
    if !force_headless && bridge::wait_for_info(DISCOVER_GRACE) {
        return bridge::run();
    }
    headless::run()
}

/// In-flight tool calls forwarded to a window's frontend, awaiting its reply.
///
/// The server thread registers a request, emits [`REQUEST_EVENT`], and blocks on the
/// channel; the frontend completes it through the `mcp_respond` command.
#[derive(Default)]
pub struct Pending {
    waiters: Mutex<HashMap<u64, SyncSender<Result<Value, String>>>>,
    /// Windows whose frontend has registered its MCP listener (so a forwarded
    /// call can be answered). A call before this fails fast instead of waiting.
    ready: Mutex<HashSet<String>>,
    seq: AtomicU64,
}

impl Pending {
    /// Allocate an id and a channel to wait on the frontend's reply.
    pub fn register(&self) -> (u64, Receiver<Result<Value, String>>) {
        let id = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = sync_channel(1);
        self.waiters
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .insert(id, tx);
        (id, rx)
    }

    /// Complete a forwarded call. Returns `true` when the id was still waiting.
    pub fn resolve(&self, id: u64, result: Result<Value, String>) -> bool {
        let waiter = self
            .waiters
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(&id);
        match waiter {
            Some(tx) => tx.send(result).is_ok(),
            None => false,
        }
    }

    /// Mark a window's frontend as listening for `mcp:request`.
    pub fn mark_ready(&self, label: &str) {
        self.ready
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .insert(label.to_string());
    }

    /// Whether a window's frontend has registered its MCP listener.
    pub fn is_ready(&self, label: &str) -> bool {
        self.ready
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .contains(label)
    }
}
