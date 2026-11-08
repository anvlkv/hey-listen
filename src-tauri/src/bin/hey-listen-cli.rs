//! `hey-listen-cli` — the GUI-free batch CLI.
//!
//! A plain console binary (not the GUI), like `heylisten-mcp`: it runs
//! `analyzers` / `analyze` / `compare` / `project` / `annotations` / `synth` over the
//! same `cli::batch::run` and the shared headless session, with **no Tauri app, no
//! window and no log plugin** — so it boots a bare GUI-less host, writes stdout on
//! Windows, and never aborts over a log path. The interface is parsed with `clap`
//! derive (`src-tauri/src/cli/batch/clap_args.rs`); the JSONL envelope is the same one
//! the app binary printed, byte for byte. See `docs/cli.md` and ADR-29.
//!
//! The app binary keeps only `--mcp` / `--headless` and the `.heyl` open path.

use std::io::Write as _;

fn main() {
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let code = hey_listen_lib::run_batch_cli(std::env::args_os(), &mut out);
    // A buffered write that fails at exit is not a success (audit P2 #12).
    std::process::exit(hey_listen_lib::finish_batch_cli(code, out.flush()));
}
