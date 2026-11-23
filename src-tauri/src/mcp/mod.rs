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
//! The server binds a `127.0.0.1` port and publishes it — with the owning pid — in the
//! MCP settings store ([`advertise`]). The `heylisten-mcp` bridge is a dumb byte pump
//! between stdio and that socket, so the MCP protocol lives in one place (the app) and an
//! agent always talks to the *running* project. With no app running at all, the bridge
//! starts the GUI once and attaches to it ([`launch`]).
//!

pub mod advertise;
pub mod bridge;
pub mod dispatch;
pub mod headless;
pub mod launch;
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

/// The first line the bridge sends, so the server can reject a connection that is not a
/// Hey Listen bridge (a reused port). It is a protocol greeting, not a secret: the server
/// is loopback-only, and a token stored beside the port in a world-readable file bought no
/// additional protection.
pub const HELLO: &str = "heylisten-mcp/1";

/// Fallback protocol version when the client does not request one we recognise.
/// The server echoes the client's requested version when it is present, so newer
/// clients negotiate their own revision.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// How long a forwarded call waits for the window to **acknowledge** it.
///
/// A window that cannot answer (its frontend is still starting up, or its listener is
/// gone) must fail fast: the emit is fire-and-forget, so without this the server would
/// block for [`RESPONSE_TIMEOUT`] while the client gave up and killed the bridge.
pub const ACK_TIMEOUT: Duration = Duration::from_secs(3);

/// How long a forwarded tool call waits for the window to answer **after** it has
/// acknowledged receipt.
///
/// Kept under an MCP client's own request timeout (60 s in Zed) on purpose: past that
/// the client has already aborted the call and closed the bridge's stdin, so a longer
/// wait only turns an actionable "did not respond in time" error into a dead session.
pub const RESPONSE_TIMEOUT: Duration = Duration::from_secs(50);

/// The default loopback port for the local MCP server (the popover shows / edits it).
pub const DEFAULT_PORT: u16 = 47100;

/// How long the stdio entry waits for a running app to advertise a live endpoint before
/// starting the GUI, and again for the app it just started to advertise.
///
/// It must outlast a normal app start **and** a relaunch after an update: the MCP client
/// launches this process, not the app, so it may well be first — and during a relaunch
/// the previous process is gone while the new one has not published yet, which looks like
/// "nothing running". So the first grace is spent before a launch is even considered: an
/// app that publishes during it is bridged to instead, and a relaunching app is never
/// duplicated. Two graces (40 s) stay under an MCP client's own startup timeout (60 s in
/// Zed), so a wait never outlives the `initialize` it is holding up. `--headless` skips
/// both.
const DISCOVER_GRACE: Duration = Duration::from_secs(20);

/// The MCP **stdio entry** shared by `hey-listen --mcp` and `heylisten-mcp`.
///
/// Auto-detects: a running, MCP-enabled app is **bridged** to (UI following, as
/// delivered); with nothing running it **starts the GUI** and bridges to that; otherwise
/// it runs the **core-native headless** server. Discovery keeps probing for
/// [`DISCOVER_GRACE`], so a client started before the app (or while the app restarts)
/// still bridges once the app advertises itself, and an app process that is alive but has
/// not published yet is never started a second time ([`launch::decide`]). A stale
/// advertisement (a crashed app) does not count — the recorded pid must match this app and
/// be alive, and the endpoint is probed (audit P2 #7). `force_headless` (`--headless`)
/// skips the probe and the launch.
pub fn run(force_headless: bool) -> std::io::Result<()> {
    if force_headless {
        return headless::run();
    }

    if bridge::wait_for_live(DISCOVER_GRACE) {
        return attach();
    }

    // Nothing answered. Start the GUI only when nothing of ours is running at all, then
    // give it the same grace a normal start gets before falling back to headless.
    let mut launcher = launch::Launcher::new(launch::current_target());
    if launcher.ensure() && bridge::wait_for_live(DISCOVER_GRACE) {
        return attach();
    }
    headless::run()
}

/// Bridge to the endpoint discovery found, or serve headless when the app behind it will
/// not take us — for example the old port now belongs to another process while the store
/// still names it. No client byte has been read yet (attach never touches stdin), so
/// serving headless is still safe and beats exiting.
fn attach() -> std::io::Result<()> {
    match bridge::attach() {
        Ok(stream) => bridge::pump_stdio(stream),
        Err(err) => {
            log::warn!("MCP bridge could not attach ({err}); serving headless");
            headless::run()
        }
    }
}

/// In-flight tool calls forwarded to a window's frontend, awaiting its receipt and
/// then its reply.
///
/// The server thread registers a request, emits [`REQUEST_EVENT`], and blocks on the
/// channels; the frontend acknowledges it through the `mcp_ack` command as soon as it
/// receives it and completes it through `mcp_respond`.
#[derive(Default)]
pub struct Pending {
    waiters: Mutex<HashMap<u64, Channels>>,
    /// Windows whose frontend has registered its MCP listener (so a forwarded
    /// call can be answered). A call before this fails fast instead of waiting.
    ready: Mutex<HashSet<String>>,
    seq: AtomicU64,
}

/// One registered call's two channels: the window's receipt, then its reply.
struct Channels {
    ack: SyncSender<()>,
    reply: SyncSender<Result<Value, String>>,
}

/// A registered forwarded call: the id to put in the payload, plus the channels the
/// caller waits on.
pub struct Call {
    pub id: u64,
    /// Fires when the target window has the request in hand (see [`Pending::acknowledge`]).
    pub ack: Receiver<()>,
    /// Carries the tool result, or the message that explains why there is none.
    pub reply: Receiver<Result<Value, String>>,
}

impl Pending {
    /// Allocate an id and the channels to wait on the frontend's receipt and reply.
    pub fn register(&self) -> Call {
        let id = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let (ack_tx, ack) = sync_channel(1);
        let (reply_tx, reply) = sync_channel(1);
        self.waiters
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .insert(
                id,
                Channels {
                    ack: ack_tx,
                    reply: reply_tx,
                },
            );
        Call { id, ack, reply }
    }

    /// Record that the frontend received call `id`.
    ///
    /// Returns `false` when the call is no longer waiting (the caller already gave up),
    /// so a late acknowledgement is a no-op rather than a blocking send.
    pub fn acknowledge(&self, id: u64) -> bool {
        let ack = self
            .waiters
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .get(&id)
            .map(|channels| channels.ack.clone());
        match ack {
            Some(ack) => ack.try_send(()).is_ok(),
            None => false,
        }
    }

    /// A guard that removes `id`'s waiter when dropped.
    ///
    /// A forwarded call must clean up on **every** early return — the emit can fail, and
    /// the reply may time out — not only when the frontend answers (audit P2 #8).
    pub fn waiter(&self, id: u64) -> Waiter<'_> {
        Waiter { pending: self, id }
    }

    /// Complete a forwarded call. Returns `true` when the id was still waiting.
    pub fn resolve(&self, id: u64, result: Result<Value, String>) -> bool {
        let waiter = self
            .waiters
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(&id);
        match waiter {
            Some(channels) => {
                // A reply also proves the window got the request, so it satisfies the
                // acknowledgement — the caller must never see "no ack" for a call that
                // answered before the ack landed.
                let _ = channels.ack.try_send(());
                channels.reply.send(result).is_ok()
            }
            None => false,
        }
    }

    /// Drop a forwarded call's waiter (a no-op when it was already resolved).
    fn cancel(&self, id: u64) {
        self.waiters
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(&id);
    }

    /// How many forwarded calls are still waiting (tests pin the cleanup).
    #[cfg(test)]
    fn pending_len(&self) -> usize {
        self.waiters
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .len()
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

/// A registered waiter that removes itself on drop, however the call ends.
pub struct Waiter<'a> {
    pending: &'a Pending,
    id: u64,
}

impl Drop for Waiter<'_> {
    fn drop(&mut self) {
        self.pending.cancel(self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// A forwarded call that fails to emit, and one that times out, must both drop their
    /// waiter: before the fix they stayed in the map until a late reply or process exit
    /// (audit P2 #8).
    #[test]
    fn a_dropped_waiter_is_cancelled() {
        let pending = Pending::default();
        let call = pending.register();
        {
            let _waiter = pending.waiter(call.id);
        }
        assert_eq!(pending.pending_len(), 0);
        assert!(
            !pending.resolve(call.id, Ok(Value::Null)),
            "a cancelled waiter cannot be resolved"
        );
    }

    #[test]
    fn a_timed_out_waiter_is_cancelled() {
        let pending = Pending::default();
        let call = pending.register();
        let waiter = pending.waiter(call.id);

        let started = Instant::now();
        let error = call
            .reply
            .recv_timeout(Duration::from_millis(20))
            .expect_err("the window does not answer");
        assert!(matches!(error, std::sync::mpsc::RecvTimeoutError::Timeout));
        assert!(started.elapsed() >= Duration::from_millis(20));

        drop(waiter);
        assert_eq!(pending.pending_len(), 0, "the timeout left a waiter behind");
    }

    #[test]
    fn an_answered_waiter_leaves_nothing_behind() {
        let pending = Pending::default();
        let call = pending.register();
        let _waiter = pending.waiter(call.id);
        assert!(pending.resolve(call.id, Ok(Value::Null)));
        assert!(call.reply.recv().expect("answered").is_ok());
        assert_eq!(pending.pending_len(), 0);
    }

    /// The frontend acknowledges a call it received, so the server can tell "busy window"
    /// from "window that cannot answer" instead of blocking for the whole response timeout.
    #[test]
    fn an_acknowledged_call_waits_for_its_reply() {
        let pending = Pending::default();
        let call = pending.register();
        let _waiter = pending.waiter(call.id);

        assert!(pending.acknowledge(call.id));
        call.ack.try_recv().expect("the receipt is recorded");
        // It must still wait for the result after acknowledging.
        assert!(matches!(
            call.reply.recv_timeout(Duration::from_millis(20)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));

        assert!(pending.resolve(call.id, Ok(Value::Null)));
        assert!(call.reply.recv().expect("answered").is_ok());
    }

    /// An unanswered call is identifiable as such: no receipt arrives within the budget.
    #[test]
    fn an_unreceived_call_gets_no_acknowledgement() {
        let pending = Pending::default();
        let call = pending.register();
        let _waiter = pending.waiter(call.id);

        let error = call
            .ack
            .recv_timeout(Duration::from_millis(20))
            .expect_err("a window that cannot answer never acknowledges");
        assert!(matches!(error, std::sync::mpsc::RecvTimeoutError::Timeout));
    }

    /// A reply that arrives before the acknowledgement must not look like "no ack" — the
    /// `is_ready` fast path is not the only way a call can be proven delivered.
    #[test]
    fn a_reply_satisfies_the_acknowledgement() {
        let pending = Pending::default();
        let call = pending.register();
        let _waiter = pending.waiter(call.id);

        assert!(pending.resolve(call.id, Ok(Value::Null)));
        assert!(call.ack.try_recv().is_ok(), "the reply implies receipt");
    }

    /// A late acknowledgement (the caller already timed out and cancelled) is a no-op:
    /// it must not block the frontend's `mcp_ack` command.
    #[test]
    fn a_late_acknowledgement_is_a_no_op() {
        let pending = Pending::default();
        let call = pending.register();
        drop(pending.waiter(call.id));
        assert!(!pending.acknowledge(call.id));
        assert!(!pending.acknowledge(4242), "an unknown id is ignored");
    }
}
