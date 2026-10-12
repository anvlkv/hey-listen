//! `heylisten-mcp` — the standalone stdio MCP entry.
//!
//! A plain console binary (not the GUI), so it works with no window at all — on a
//! headless host, in CI, and in the Windows release build where the app binary has
//! no console. It **auto-detects**: a running, MCP-enabled app serves the tools
//! (bridge + UI following); otherwise it runs the core-native **headless** server.
//! Pass `--headless` to skip the bridge probe. See `docs/mcp.md`.
//!
//! Because this binary is not a Tauri app, it does not use the `cli` plugin for its
//! one flag (that plugin needs an app context); the app binary's flags are defined in
//! `tauri.conf.json` (`plugins.cli`).

fn main() {
    let headless = std::env::args().skip(1).any(|arg| arg == "--headless");
    if let Err(err) = hey_listen_lib::run_mcp(headless) {
        eprintln!("heylisten-mcp: {err}");
        std::process::exit(1);
    }
}
