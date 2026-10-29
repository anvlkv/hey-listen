//! Export flags for the batch CLI (`--format` / `--csv` / `--out`): parse them into
//! the request and reject combinations the runner cannot honour.
//!
//! Split from [`super::args`] to keep each file inside the source-size budget. The
//! generic `string` / `flag` accessors and `result_count` come from there.

use tauri_plugin_cli::Matches;

use crate::export::ExportFormat;

use super::args::{flag, result_count, string};
use super::types::{Command, OutputTarget, Request};

/// `json` (default) or `csv`; `--csv` is shorthand for `--format csv`.
pub(super) fn parse_format(matches: &Matches) -> Result<ExportFormat, String> {
    let explicit = string(matches, "format");
    let csv = flag(matches, "csv");
    match explicit.as_deref() {
        None => Ok(if csv {
            ExportFormat::Csv
        } else {
            ExportFormat::Json
        }),
        Some("csv") => Ok(ExportFormat::Csv),
        Some("json") if csv => Err("use either `--format json` or `--csv`, not both".into()),
        Some("json") => Ok(ExportFormat::Json),
        Some(other) => Err(format!("unknown --format: {other} (use json or csv)")),
    }
}

/// An existing directory (or a trailing separator) is a directory target; anything
/// else is a single output file.
pub(super) fn output_target(path: String) -> OutputTarget {
    let directory =
        path.ends_with('/') || path.ends_with('\\') || std::path::Path::new(&path).is_dir();
    if directory {
        OutputTarget::Dir(path)
    } else {
        OutputTarget::File(path)
    }
}

/// Check `--format` / `--out`: `--out` needs analysis results, a file target needs
/// exactly one, and CSV on stdout cannot represent more than one result.
pub(super) fn validate(request: &Request) -> Result<(), String> {
    if request.format == ExportFormat::Csv && request.summary {
        return Err("--summary cannot be combined with CSV (a CSV export needs the data)".into());
    }
    let Some(target) = &request.out else {
        if request.format == ExportFormat::Csv && result_count(request) != 1 {
            return Err(
                "CSV on stdout needs exactly one result; use `--out DIR` for a batch".into(),
            );
        }
        return Ok(());
    };
    match &request.command {
        Command::Analyze => {}
        Command::Synth { .. } => {
            if request.tools.is_empty() && !request.all {
                return Err("--out needs `-t <TOOL>` (or `--all`) to export an analysis".into());
            }
        }
        Command::Analyzers { .. } | Command::Notes { .. } => {
            return Err("--out is only for `analyze` and `synth`".into());
        }
    }
    if request.summary {
        return Err("--summary cannot be combined with --out (an export needs the data)".into());
    }
    if matches!(target, OutputTarget::File(_)) && result_count(request) != 1 {
        return Err("`--out FILE` needs exactly one result; use a directory for a batch".into());
    }
    Ok(())
}
