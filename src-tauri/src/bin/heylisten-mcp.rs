//! `heylisten-mcp` — the stdio ⇄ localhost MCP bridge.
//!
//! Point an MCP client (e.g. Zed's `context_servers`) at this binary to drive the
//! **running** Hey Listen app: tool calls are served by the app itself, so an agent
//! steers the user's project window. See `docs/mcp.md`.
//!
//! A separate console binary (not the GUI) so stdio works on every platform,
//! including Windows release where `hey-listen` has no console.

fn main() {
    if let Err(err) = hey_listen_lib::run_mcp() {
        eprintln!("heylisten-mcp: {err}");
        std::process::exit(1);
    }
}
