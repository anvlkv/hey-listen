//! Command-line interface (`tauri-plugin-cli`).
//!
//! The interface is **declared in `tauri.conf.json`** under `plugins.cli`, so the
//! definition lives with the rest of the app config and drives `--help`. The app
//! binary reads the parsed matches in `setup` and routes one of three entries
//! **without opening a window** (`src-tauri/src/lib.rs`):
//!
//! - `--mcp` → the stdio MCP entry ([`crate::mcp::run`]),
//! - a **batch subcommand** (`analyzers` / `analyze` / `synth`) → [`batch`],
//! - neither → the GUI.
//!
//! A `.heyl` path passed on the command line (file association) is *not* a flag: the
//! plugin's parser rejects unknown positionals, so [`parse`] treats a parse error as
//! "no flags" and the existing `opened_paths_from_args` handling in
//! [`crate::commands::project`] opens it as usual. The one exception: when the argv
//! clearly targets a batch subcommand, a parse error is a **usage error** — we print
//! it and exit `2` instead of silently launching the GUI.
//!
//! The standalone `heylisten-mcp` binary is **not** a Tauri app (so it can run with
//! no GUI, e.g. on a headless host or the Windows release build) and reads its one
//! flag directly — see `src/bin/heylisten-mcp.rs`.

pub mod batch;

use tauri::{AppHandle, Runtime};
use tauri_plugin_cli::{CliExt, Matches};

/// What the app binary was asked to do, resolved from the parsed CLI matches.
#[allow(clippy::large_enum_variant)]
pub enum Entry {
    /// No CLI action: build the GUI.
    Gui,
    /// `--mcp`: run the stdio MCP entry (`--headless` forces the core-native server).
    Mcp { headless: bool },
    /// A batch subcommand (`analyzers` / `analyze` / `synth`).
    Batch(batch::Request),
    /// A usage error for a batch subcommand: print to stderr and exit `2`.
    Usage(String),
}

/// Resolve the process arguments into an [`Entry`].
///
/// `--help` / `--version` are printed and the process exits. Any other parse failure
/// (e.g. a `.heyl` file path) yields [`Entry::Gui`] so normal startup — and
/// file-open handling — proceeds unchanged, *unless* the argv targets a batch
/// subcommand, in which case the error is returned as [`Entry::Usage`].
pub fn parse<R: Runtime>(app: &AppHandle<R>) -> Entry {
    let matches = match app.cli().matches() {
        Ok(matches) => matches,
        Err(err) => {
            return if subcommand_in_argv() {
                Entry::Usage(err.to_string())
            } else {
                Entry::Gui
            };
        }
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

    if let Some(subcommand) = matches.subcommand.as_ref() {
        return match batch::build_request(&subcommand.name, &subcommand.matches) {
            Ok(request) => Entry::Batch(request),
            Err(message) => Entry::Usage(message),
        };
    }

    Entry::Gui
}

/// Whether the process was launched as a **non-GUI** entry: `--mcp` / `--headless` or
/// a batch subcommand (`analyzers` / `analyze` / `synth` / `notes`).
///
/// Used before the Tauri builder is assembled to skip GUI-only plugins (the WebDriver
/// server binds a port and logs a preamble; that must not reach the CLI's stdout).
pub fn is_cli_invocation() -> bool {
    std::env::args()
        .skip(1)
        .any(|arg| arg == "--mcp" || arg == "--headless")
        || subcommand_in_argv()
}

/// Whether the first positional token in `argv` names a batch subcommand.
///
/// The top-level flags (`--mcp` / `--headless`) take no values, so the first
/// non-flag token is exactly the token clap would treat as the subcommand.
fn subcommand_in_argv() -> bool {
    std::env::args()
        .skip(1)
        .find(|arg| !arg.starts_with('-'))
        .map(|arg| batch::is_subcommand(&arg))
        .unwrap_or(false)
}

/// Read a boolean flag from the parsed matches.
fn flag(matches: &Matches, name: &str) -> bool {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_bool())
        .unwrap_or(false)
}
