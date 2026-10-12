// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `--mcp` runs the stdio ⇄ localhost MCP bridge instead of the GUI, so an MCP
    // client can point at this binary directly (see `docs/mcp.md`). On Windows
    // release the app binary has no console, so use the `heylisten-mcp` binary.
    if std::env::args().skip(1).any(|arg| arg == "--mcp") {
        if let Err(err) = hey_listen_lib::run_mcp() {
            eprintln!("hey-listen --mcp: {err}");
            std::process::exit(1);
        }
        return;
    }
    hey_listen_lib::run()
}
