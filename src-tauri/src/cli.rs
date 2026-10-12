//! Command-line interface (`tauri-plugin-cli`).
//!
//! The flags are **declared in `tauri.conf.json`** under `plugins.cli`, so the
//! definition lives with the rest of the app config and drives `--help`. The app
//! binary reads the parsed [`CliArgs`] in `setup` and routes `--mcp` **without
//! opening a window** (`src-tauri/src/lib.rs`).
//!
//! A `.heyl` path passed on the command line (file association) is *not* a flag: the
//! plugin's parser rejects unknown positionals, so [`parse`] treats a parse error as
//! "no flags" and the existing `opened_paths_from_args` handling in
//! [`crate::commands::project`] opens it as usual.
//!
//! The standalone `heylisten-mcp` binary is **not** a Tauri app (so it can run with
//! no GUI, e.g. on a headless host or the Windows release build) and reads its one
//! flag directly — see `src/bin/heylisten-mcp.rs`.

use tauri::{AppHandle, Runtime};
use tauri_plugin_cli::CliExt;

/// The flags the app binary recognises (see `tauri.conf.json` → `plugins.cli`).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct CliArgs {
    /// `--mcp`: run the stdio MCP entry instead of the GUI.
    pub mcp: bool,
    /// `--headless`: force the core-native headless MCP server (only meaningful with
    /// `--mcp`).
    pub headless: bool,
}

/// Parse the process arguments against the CLI definition.
///
/// `--help` / `--version` are printed and the process exits. Any other parse failure
/// (e.g. a `.heyl` file path) yields [`CliArgs::default`] so normal startup — and
/// file-open handling — proceeds unchanged.
pub fn parse<R: Runtime>(app: &AppHandle<R>) -> CliArgs {
    let Ok(matches) = app.cli().matches() else {
        return CliArgs::default();
    };
    if let Some(help) = matches.args.get("help").and_then(|arg| arg.value.as_str()) {
        print!("{help}");
        std::process::exit(0);
    }
    if matches.args.contains_key("version") {
        println!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
        std::process::exit(0);
    }
    let flag = |name: &str| {
        matches
            .args
            .get(name)
            .and_then(|arg| arg.value.as_bool())
            .unwrap_or(false)
    };
    CliArgs {
        mcp: flag("mcp"),
        headless: flag("headless"),
    }
}
