// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // CLI flags (`--mcp`, `--headless`) are declared in `tauri.conf.json`
    // (`plugins.cli`) and routed in the library's `setup` — see `src/cli.rs` and
    // `src/lib.rs`. A `.heyl` path passed on the command line is handled there too.
    hey_listen_lib::run()
}
