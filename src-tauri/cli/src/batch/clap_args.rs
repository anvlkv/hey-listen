//! The `hey-listen-cli` console binary: its `clap` interface and the mapping from the
//! parsed matches onto a [`Request`](super::Request) (ADR-29).
//!
//! The batch subcommands used to be declared in `tauri.conf.json` → `plugins.cli` and
//! parsed by the app binary; they now live here, in a plain console process with no
//! Tauri app, no window and no log plugin. The vocabulary is the same, the mapping is
//! the same ([`build_request`]), and the JSONL envelope is unchanged — the rehost is
//! pinned by `src/batch/tests/console.rs`, which maps the same command lines through both
//! parsers and compares the output.

use std::ffi::OsString;
use std::io::Write;

use clap::{ArgMatches, Args, CommandFactory, Parser, Subcommand};

use super::args::ArgSource;
use super::build_request;

/// The parser. `arg_required_else_help` makes a bare `hey-listen-cli` print its help
/// (exit `2` via clap's `DisplayHelpOnMissingArgumentOrSubcommand`).
#[derive(Parser)]
#[command(
    name = "hey-listen-cli",
    version,
    about = "Hey Listen — batch audio analysis (no window; JSONL on stdout)",
    arg_required_else_help = true,
    disable_help_subcommand = true
)]
struct Cli {
    #[command(subcommand)]
    command: Batch,
}

#[derive(Subcommand)]
enum Batch {
    /// List the analyzer catalog, or explain one analyzer's options
    Analyzers(AnalyzersArgs),
    /// Decode file(s) and run analyzer(s) over a window
    Analyze(AnalyzeArgs),
    /// Render a synth graph and (optionally) analyze the result
    Synth(SynthArgs),
    /// List, get, add, update or delete the annotations in a project file (.heyl)
    Annotations(AnnotationsArgs),
    /// Diff one analyzer across two project files
    Compare(CompareArgs),
    /// Build a .heyl project from a source + setup + tabs, without opening a window
    Project(ProjectArgs),
    /// Upgrade project files to the current format version (incremental, atomic)
    Migrate(MigrateArgs),
}

#[derive(Args)]
struct AnalyzersArgs {
    /// Analyzer id to explain (default: list the catalog)
    #[arg(value_name = "ID")]
    id: Option<String>,
    /// Emit the catalog (or the one analyzer) as JSON instead of a table
    #[arg(long)]
    json: bool,
}

/// `-t` / `--all`, shared by every subcommand that runs analyzers.
#[derive(Args)]
struct ToolArgs {
    /// Analyzer id to run (repeatable); required unless --all
    #[arg(short, long, value_name = "ID")]
    tool: Vec<String>,
    /// Run every analyzer in the catalog
    #[arg(long)]
    all: bool,
}

/// `-p` / `-o` patches, shared by `analyze` / `synth` / `compare` / `project`.
#[derive(Args)]
struct PatchArgs {
    /// Shared param patch K=V (repeatable)
    #[arg(short, long, value_name = "K=V")]
    param: Vec<String>,
    /// Per-tool option patch [TOOL.]K=V (repeatable); `analyzers <ID>` lists the keys
    #[arg(short, long, value_name = "[TOOL.]K=V")]
    option: Vec<String>,
}

/// How much of each result to print, shared by `analyze` / `synth` / `compare`.
#[derive(Args)]
struct ReportArgs {
    /// Include the raw result arrays (default: compacted)
    #[arg(long)]
    full: bool,
    /// Emit the summary only, without result arrays (not with --full)
    #[arg(long)]
    summary: bool,
    /// Pretty-print a single result instead of one JSON line per result
    #[arg(long)]
    pretty: bool,
    /// Stop at the first failing file/tool
    #[arg(long)]
    fail_fast: bool,
}

/// `--format` / `--csv` / `--out`, shared by `analyze` / `synth`.
#[derive(Args)]
struct ExportArgs {
    /// Data export format: json (JSONL / provenance envelope) or csv (wide matrix)
    #[arg(long, value_name = "json|csv")]
    format: Option<String>,
    /// Shorthand for --format csv
    #[arg(long)]
    csv: bool,
    /// Write results to a file (one result) or a directory (one file per result)
    #[arg(long, value_name = "FILE|DIR")]
    out: Option<String>,
}

#[derive(Args)]
struct AnalyzeArgs {
    /// Audio file(s) to decode and analyze
    #[arg(value_name = "FILE")]
    file: Vec<String>,
    #[command(flatten)]
    tools: ToolArgs,
    /// Window start in seconds (default 0)
    #[arg(long, value_name = "SEC")]
    start: Option<String>,
    /// Window end in seconds (default: full duration)
    #[arg(long, value_name = "SEC")]
    end: Option<String>,
    /// Window list file: one `start,end[,tool,tool…]` per line (# comments allowed)
    #[arg(long, value_name = "FILE")]
    windows: Option<String>,
    #[command(flatten)]
    patches: PatchArgs,
    /// Apply a filter GraphSpec (JSON file) before analysis
    #[arg(long, value_name = "FILE")]
    filter: Option<String>,
    #[command(flatten)]
    report: ReportArgs,
    #[command(flatten)]
    export: ExportArgs,
}

#[derive(Args)]
struct SynthArgs {
    /// Synth GraphSpec (JSON file) to render
    #[arg(value_name = "GRAPH.json")]
    graph: Option<String>,
    /// Rendered length in seconds (default 5)
    #[arg(long, value_name = "SEC")]
    seconds: Option<String>,
    #[command(flatten)]
    tools: ToolArgs,
    /// Window start in seconds
    #[arg(long, value_name = "SEC")]
    start: Option<String>,
    /// Window end in seconds
    #[arg(long, value_name = "SEC")]
    end: Option<String>,
    #[command(flatten)]
    patches: PatchArgs,
    /// Apply a filter GraphSpec (JSON file) before analysis
    #[arg(long, value_name = "FILE")]
    filter: Option<String>,
    #[command(flatten)]
    report: ReportArgs,
    #[command(flatten)]
    export: ExportArgs,
}

#[derive(Args)]
struct AnnotationsArgs {
    /// Project file (.heyl) to read or edit
    #[arg(value_name = "FILE.heyl")]
    file: Option<String>,
    /// Emit each annotation as one JSON line (JSONL) instead of a table
    #[arg(long)]
    json: bool,
    /// Include the full markdown body (default: a one-line excerpt)
    #[arg(long)]
    full: bool,
    /// Append the annotations in this JSON array file (title/body/timeSecs/range/tool)
    #[arg(long, value_name = "FILE.json")]
    add: Option<String>,
    /// Print one annotation by id (full body and frozen values)
    #[arg(long, value_name = "ID")]
    get: Option<String>,
    /// Patch one annotation by id; give the fields with --set
    #[arg(long, value_name = "ID")]
    update: Option<String>,
    /// With --update: FIELD=VALUE for title, body, timeSecs, range or tool (repeatable)
    #[arg(long, value_name = "FIELD=VALUE")]
    set: Vec<String>,
    /// Remove one annotation by id
    #[arg(long, value_name = "ID")]
    delete: Option<String>,
    /// Write a changed project to this copy instead of editing it in place
    #[arg(long, value_name = "FILE.heyl")]
    to: Option<String>,
}

#[derive(Args)]
struct CompareArgs {
    /// Owner project file (.heyl)
    #[arg(value_name = "A.heyl")]
    a: Option<String>,
    /// Reference project file (.heyl)
    #[arg(value_name = "B.heyl")]
    b: Option<String>,
    #[command(flatten)]
    tools: ToolArgs,
    /// Window start for both sides (seconds)
    #[arg(long, value_name = "SEC")]
    start: Option<String>,
    /// Window end for both sides (seconds)
    #[arg(long, value_name = "SEC")]
    end: Option<String>,
    /// Window start for side A only
    #[arg(long, value_name = "SEC")]
    a_start: Option<String>,
    /// Window end for side A only
    #[arg(long, value_name = "SEC")]
    a_end: Option<String>,
    /// Window start for side B only
    #[arg(long, value_name = "SEC")]
    b_start: Option<String>,
    /// Window end for side B only
    #[arg(long, value_name = "SEC")]
    b_end: Option<String>,
    /// Move side B on the relative axis (seconds; positive = later)
    #[arg(long, value_name = "SEC")]
    b_offset: Option<String>,
    /// Clip both sides to their absolute-time intersection
    #[arg(long)]
    overlap: bool,
    #[command(flatten)]
    patches: PatchArgs,
    /// Override both saved filters with this GraphSpec (JSON file)
    #[arg(long, value_name = "FILE")]
    filter: Option<String>,
    #[command(flatten)]
    report: ReportArgs,
    /// Write owner A back to this .heyl path with the reference snapshots
    #[arg(long, value_name = "OUT.heyl")]
    save: Option<String>,
    /// With --save, override the saved project's Workbench tabs (repeatable)
    #[arg(long, value_name = "ID")]
    open_tool: Vec<String>,
}

#[derive(Args)]
struct ProjectArgs {
    /// Destination .heyl path (parent folders are created)
    #[arg(value_name = "OUT.heyl")]
    dest: Option<String>,
    /// Audio file to decode as the project source
    #[arg(long, value_name = "AUDIO")]
    source: Option<String>,
    /// Synth GraphSpec (JSON file) to render as the source (instead of --source)
    #[arg(long, value_name = "GRAPH.json")]
    synth: Option<String>,
    /// Rendered length for --synth (default 5)
    #[arg(long, value_name = "SEC")]
    seconds: Option<String>,
    /// Project display name (default: the output file stem)
    #[arg(long, value_name = "NAME")]
    name: Option<String>,
    /// Analyzer tab to restore when the project opens (repeatable)
    #[arg(long, value_name = "ID")]
    open_tool: Vec<String>,
    /// Annotations JSON file: an array of annotation objects (title/body/timeSecs/…)
    #[arg(long, value_name = "FILE.json")]
    annotations: Option<String>,
    /// Write a reference project (no embedded audio) for a file source
    #[arg(long)]
    reference: bool,
    /// Analysis window start in seconds (default 0)
    #[arg(long, value_name = "SEC")]
    start: Option<String>,
    /// Analysis window end in seconds (default: full duration)
    #[arg(long, value_name = "SEC")]
    end: Option<String>,
    #[command(flatten)]
    patches: PatchArgs,
    /// Save this filter GraphSpec (JSON file) into the project
    #[arg(long, value_name = "FILE")]
    filter: Option<String>,
    /// Pretty-print the saved-project record
    #[arg(long)]
    pretty: bool,
}

#[derive(Args)]
struct MigrateArgs {
    /// Project file(s) to upgrade in place
    #[arg(value_name = "FILE.heyl")]
    file: Vec<String>,
    /// Embed a reference project's audio instead of keeping it a reference
    #[arg(long)]
    embed: bool,
    /// Do not keep a `.bak` copy beside each rewritten file
    #[arg(long)]
    no_backup: bool,
}

/// clap's argument id is the derive field name, i.e. the `plugins.cli` name with
/// underscores (`b-offset` → `b_offset`).
fn arg_id(name: &str) -> String {
    name.replace('-', "_")
}

impl ArgSource for ArgMatches {
    fn string(&self, name: &str) -> Option<String> {
        self.try_get_one::<String>(&arg_id(name))
            .ok()
            .flatten()
            .cloned()
    }

    fn strings(&self, name: &str) -> Vec<String> {
        self.try_get_many::<String>(&arg_id(name))
            .ok()
            .flatten()
            .map(|values| values.cloned().collect())
            .unwrap_or_default()
    }

    fn flag(&self, name: &str) -> bool {
        self.try_get_one::<bool>(&arg_id(name))
            .ok()
            .flatten()
            .copied()
            .unwrap_or(false)
    }
}

/// Parse `argv`, map the subcommand onto a [`Request`](super::Request) and run it,
/// writing JSONL to `out`. Returns the exit code: `0` / `1` from the run, `2` on a
/// usage error (including a clap parse error).
pub fn run<I, T>(argv: I, out: &mut impl Write) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    match request(argv) {
        Ok(request) => super::run(&request, out),
        Err(InvocationError::Clap(err)) => report(err, out),
        Err(InvocationError::Usage(message)) => {
            eprintln!("hey-listen-cli: {message}");
            2
        }
    }
}

/// Why a command line did not produce a request.
#[derive(Debug)]
pub enum InvocationError {
    /// A clap parse error, `--help` or `--version`.
    Clap(clap::Error),
    /// A usage error the request mapping rejected (bad `K=V`, missing `-t`, …).
    Usage(String),
}

/// Parse `argv` and map it onto a [`Request`](super::Request), without running it.
///
/// Shared by [`run`] and the tests, so the mapping is pinned through the real parser —
/// flags, aliases and all.
pub fn request<I, T>(argv: I) -> Result<super::Request, InvocationError>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let matches = Cli::command()
        .try_get_matches_from(argv)
        .map_err(InvocationError::Clap)?;
    let Some((name, sub)) = matches.subcommand() else {
        return Err(InvocationError::Clap(Cli::command().error(
            clap::error::ErrorKind::MissingSubcommand,
            "a subcommand is required",
        )));
    };
    build_request(name, sub).map_err(InvocationError::Usage)
}

/// Print a clap error: `--help` / `--version` go to stdout with exit `0` (they are not
/// errors), everything else to stderr with clap's own exit code (`2`).
fn report(err: clap::Error, out: &mut impl Write) -> i32 {
    use clap::error::ErrorKind;
    match err.kind() {
        ErrorKind::DisplayHelp | ErrorKind::DisplayVersion => {
            let _ = write!(out, "{err}");
            0
        }
        _ => {
            eprint!("{err}");
            err.exit_code()
        }
    }
}
