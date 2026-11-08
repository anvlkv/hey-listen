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
//! `annotations` / `compare` / `project` belong to the `hey-listen-cli` console binary
//! ([`console`], `src/bin/hey-listen-cli.rs`), which needs no Tauri app, no window and
//! no log plugin. See `docs/cli.md`.
//!
//! A `.heyl` path passed on the command line (file association) is *not* a flag: the
//! plugin's parser rejects unknown positionals, so [`parse`] treats a parse error as
//! "no flags" and the existing `opened_paths_from_args` handling in
//! [`crate::commands::project`] opens it as usual. A **former** batch subcommand
//! (`hey-listen analyze …`) is a migration mistake instead: [`parse`] prints the
//! `hey-listen-cli` spelling and exits `2`, so it cannot silently launch the GUI.
//!
//! The standalone `heylisten-mcp` binary is **not** a Tauri app either (so it can run
//! with no GUI, e.g. on a headless host or the Windows release build) and reads its one
//! flag directly — see `src/bin/heylisten-mcp.rs`.

pub mod batch;

use std::ffi::OsString;
use std::io::Write;

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
/// handling — proceeds unchanged, unless the first positional names a **retired** batch
/// subcommand, which prints the console-binary spelling and exits `2`.
pub fn parse<R: Runtime>(app: &AppHandle<R>) -> Entry {
    let matches = match app.cli().matches() {
        Ok(matches) => matches,
        Err(_) => {
            if let Some(retired) = retired_subcommand() {
                eprintln!(
                    "hey-listen: `{retired}` is no longer a subcommand of the app binary; \
                     use `hey-listen-cli {retired} …` (see docs/cli.md)"
                );
                std::process::exit(2);
            }
            return Entry::Gui;
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

    Entry::Gui
}

/// The `hey-listen-cli` entry: parse `argv` with `clap`, map the subcommand onto a
/// [`batch::Request`], run it, and write JSONL to `out`.
///
/// Returns the exit code: `0` when every file/tool succeeded, `1` when at least one
/// failed, `2` on a usage error (a clap parse error included).
pub fn console<I, T>(argv: I, out: &mut impl Write) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    batch::run_console(argv, out)
}

/// Whether the process was launched as a **non-GUI** entry: `--mcp` / `--headless`, or a
/// batch subcommand the app binary no longer declares (it exits with a migration hint).
///
/// Used before the Tauri builder is assembled to skip GUI-only plugins (the WebDriver
/// server binds a port and logs a preamble; that must not reach the MCP entry's stdout)
/// and to keep the log plugin off its file target.
pub fn is_cli_invocation() -> bool {
    std::env::args()
        .skip(1)
        .any(|arg| arg == "--mcp" || arg == "--headless")
        || retired_subcommand().is_some()
}

/// The first positional token, if it names a batch subcommand the app binary no longer
/// declares (moved to `hey-listen-cli`, ADR-29).
///
/// The top-level flags take no values, so the first non-flag token is exactly the token
/// clap would treat as the subcommand.
fn retired_subcommand() -> Option<batch::BatchCommand> {
    retired_from(std::env::args())
}

/// [`retired_subcommand`] over an explicit argv (so it can be unit-tested).
fn retired_from(args: impl IntoIterator<Item = String>) -> Option<batch::BatchCommand> {
    args.into_iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-'))
        .and_then(|arg| arg.parse().ok())
}

/// Fold the final stdout flush into the exit code, so a buffered write that fails at exit
/// is not reported as success (audit P2 #12).
pub fn finish(code: i32, flushed: std::io::Result<()>) -> i32 {
    match flushed {
        Ok(()) => code,
        Err(err) => {
            eprintln!("hey-listen: could not write the output: {err}");
            if code == 0 {
                1
            } else {
                code
            }
        }
    }
}

/// Read a boolean flag from the parsed matches.
fn flag(matches: &Matches, name: &str) -> bool {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_bool())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::batch::BatchCommand;
    use super::{finish, retired_from};

    #[test]
    fn a_failed_final_flush_is_not_success() {
        let error = std::io::Error::other("disk full");
        assert_eq!(finish(0, Err(error)), 1);
    }

    #[test]
    fn a_failed_flush_keeps_an_existing_failure() {
        assert_eq!(finish(2, Err(std::io::Error::other("disk full"))), 2);
    }

    #[test]
    fn a_clean_flush_keeps_the_code() {
        assert_eq!(finish(0, Ok(())), 0);
        assert_eq!(finish(1, Ok(())), 1);
    }

    /// A retired batch subcommand is recognised (the hint), while the GUI's two own
    /// entry points — a `.heyl` path and `--mcp` — are not.
    #[test]
    fn a_retired_subcommand_is_recognised() {
        fn retired(args: &[&str]) -> Option<BatchCommand> {
            let argv = std::iter::once("hey-listen".to_string())
                .chain(args.iter().map(|arg| arg.to_string()));
            retired_from(argv)
        }
        assert_eq!(
            retired(&["analyze", "call.wav", "-t", "levels"]),
            Some(BatchCommand::Analyze)
        );
        assert_eq!(
            retired(&["annotations", "x.heyl"]),
            Some(BatchCommand::Annotations)
        );
        assert_eq!(retired(&["/tmp/mix.heyl"]), None);
        assert_eq!(retired(&["--mcp"]), None);
        assert_eq!(retired(&[]), None);
    }
}
