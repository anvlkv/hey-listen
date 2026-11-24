//! The project-file subcommands' arguments: `project` builds a `.heyl` and `migrate`
//! upgrades files to the current format version.

use clap::Args;

use super::PatchArgs;

#[derive(Args)]
pub(super) struct ProjectArgs {
    /// Destination .heyl path (parent folders are created)
    #[arg(value_name = "OUT.heyl")]
    dest: Option<String>,
    /// Audio file to decode as the project source
    #[arg(long, value_name = "AUDIO")]
    source: Option<String>,
    /// Synth graph (DOT file/string; legacy JSON accepted) to render as the source
    #[arg(long, value_name = "GRAPH")]
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
    /// How the file persists the audio (default: embedded); wins over --reference
    #[arg(long, value_name = "embedded|linked|live-link")]
    storage: Option<String>,
    /// Analysis window start in seconds (default 0)
    #[arg(long, value_name = "SEC")]
    start: Option<String>,
    /// Analysis window end in seconds (default: full duration)
    #[arg(long, value_name = "SEC")]
    end: Option<String>,
    #[command(flatten)]
    patches: PatchArgs,
    /// Save this filter graph (DOT file/string; legacy JSON accepted) into the project
    #[arg(long, value_name = "FILE|DOT")]
    filter: Option<String>,
    /// Pretty-print the saved-project record
    #[arg(long)]
    pretty: bool,
}

#[derive(Args)]
pub(super) struct MigrateArgs {
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
