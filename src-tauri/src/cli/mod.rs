//! Command-line interface (`tauri-plugin-cli`).
//!
//! The app binary's flags are **declared in `tauri.conf.json`** under `plugins.cli`
//! (`--mcp` / `--headless`), so the definition lives with the rest of the app config
//! and drives `--help`. [`parse`] resolves them in `setup` and routes one of two
//! entries **without opening a window** (`src-tauri/src/lib.rs`):
//!
//! - `--mcp` → the stdio MCP entry ([`crate::mcp::run`]),
//! - neither → the GUI.
//!
//! The **batch subcommands are not here** (ADR-29): `analyzers` / `analyze` / `synth` /
//! `annotations` / `compare` / `project` belong to the `hey-listen-cli` console binary —
//! the `src-tauri/cli/` crate, which owns both their interface and their implementation
//! and needs no Tauri app, no window and no log plugin. The app binary declares none of
//! them, so `hey-listen analyze …` is simply an argument it does not accept. See
//! `docs/cli.md`.
//!
//! A `.heyl` path passed on the command line (file association) is *not* a flag: the
//! plugin's parser rejects unknown positionals, so [`parse`] treats a parse error as
//! "no flags" and the existing `opened_paths_from_args` handling in
//! [`crate::commands::project`] opens it as usual.
//!
//! The standalone `heylisten-mcp` binary is **not** a Tauri app either (so it can run
//! with no GUI, e.g. on a headless host or the Windows release build) and reads its one
//! flag directly — see the `heylisten-mcp` crate (`src-tauri/mcp/src/main.rs`).

use tauri::{AppHandle, Runtime};
use tauri_plugin_cli::{CliExt, Matches};

/// What the app binary was asked to do, resolved from the parsed CLI matches.
pub enum Entry {
    /// No CLI action: build the GUI.
    Gui,
    /// `--mcp`: run the stdio MCP entry (`--headless` forces the core-native server).
    Mcp { headless: bool },
}

/// Resolve the process arguments into an [`Entry`].
///
/// `--help` / `--version` are printed and the process exits. Any other parse failure
/// (e.g. a `.heyl` file path) yields [`Entry::Gui`] so normal startup — and file-open
/// handling — proceeds unchanged.
pub fn parse<R: Runtime>(app: &AppHandle<R>) -> Entry {
    let matches = match app.cli().matches() {
        Ok(matches) => matches,
        Err(_) => return Entry::Gui,
    };

    // `--help` / `--version` come back as matches (the plugin prints and errors);
    // surface them the same way the pre-M10 app did.
    if let Some(help) = matches.args.get("help").and_then(|arg| arg.value.as_str()) {
        print!("{help}");
        std::process::exit(0);
    }
    if matches.args.contains_key("version") {
        println!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
        std::process::exit(0);
    }

    if flag(&matches, "mcp") {
        return Entry::Mcp {
            headless: flag(&matches, "headless"),
        };
    }

    Entry::Gui
}

/// Whether the process was launched as a **non-GUI** entry: `--mcp` / `--headless`.
///
/// Used before the Tauri builder is assembled to skip GUI-only plugins (the WebDriver
/// server binds a port and logs a preamble; that must not reach the MCP entry's stdout)
/// and to keep the log plugin off its file target.
pub fn is_cli_invocation() -> bool {
    std::env::args()
        .skip(1)
        .any(|arg| arg == "--mcp" || arg == "--headless")
}

/// Read a boolean flag from the parsed matches.
fn flag(matches: &Matches, name: &str) -> bool {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_bool())
        .unwrap_or(false)
}
