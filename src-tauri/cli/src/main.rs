//! `hey-listen-cli` — the GUI-free batch CLI.
//!
//! A plain console binary (not the GUI), like `heylisten-mcp`: it runs
//! `analyzers` / `analyze` / `compare` / `project` / `annotations` / `synth` over the
//! [`batch`] module and the shared headless session, with **no Tauri app, no window and
//! no log plugin** — so it boots a bare GUI-less host, writes stdout on Windows, and
//! never aborts over a log path. The interface is parsed with `clap` derive
//! (`src/batch/clap_args.rs`); the JSONL envelope is the same one the app binary printed,
//! byte for byte. See `docs/cli.md` and ADR-29.
//!
//! It is its own crate (`src-tauri/cli/`, package `hey-listen-cli`) that links the app
//! crate as a library: the app package therefore has no `hey-listen-cli` bin target, so
//! the rpm/msi bundles cannot install it twice (it also ships as the `bundle.externalBin`
//! sidecar — see `docs/packaging.md`). The app binary keeps only `--mcp` / `--headless`
//! and the `.heyl` open path.

mod batch;
mod exit;

use std::io::Write as _;

fn main() {
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let code = batch::run_console(std::env::args_os(), &mut out);
    // A buffered write that fails at exit is not a success (audit P2 #12).
    std::process::exit(exit::finish(code, out.flush()));
}
