//! Saving a CLI comparison back into the owner project (M25.D).
//!
//! `compare A.heyl B.heyl -t TOOL --save OUT.heyl` writes **A** with one `COMPARE`
//! snapshot per tool that compared, so opening `OUT.heyl` in the app shows the same
//! comparison (a compare tab bound to the saved reference). The saved setup is A's
//! **effective** setup — the `-p` / `-o` / `--start` / `--end` / `--filter` overrides
//! included — so reopening it reproduces the diff instead of a silently different one.

use crate::audio::analysis::compare::SavedComparison;
use crate::project::side::Side;
use crate::project::{write_project, AnalysisWindow, SaveProject, SourceKind};

use super::types::{Command, Request};

/// Write the owner side back to `--save`, or do nothing without it.
pub(super) fn save_owner(
    a: &Side,
    request: &Request,
    snapshots: Vec<SavedComparison>,
) -> Result<(), String> {
    let Command::Compare {
        save: Some(path),
        open_tools,
        ..
    } = &request.command
    else {
        return Ok(());
    };

    let mut setup = a.setup.clone();
    // The effective settings the diff ran with (the base map plus any `-o` patches).
    setup.tool_options = a.options.clone();
    setup.window = AnalysisWindow {
        start_secs: a.window.0,
        end_secs: a.window.1,
    };
    if !open_tools.is_empty() {
        setup.open_tools = open_tools.clone();
    }

    let mut layout = a.layout.clone();
    if let Some(filter) = &request.filter {
        // The completed filter is what the diff used; writing it keeps a reopen faithful.
        layout["filterSpec"] = serde_json::to_value(filter).map_err(|err| err.to_string())?;
        setup.filter_enabled = true;
    }

    // A reference project stays a reference project (no PCM); anything else embeds the
    // audio we decoded, so the saved owner is self-contained.
    let can_reference = !a.embedded
        && a.source
            .as_ref()
            .is_some_and(|source| source.kind == SourceKind::File && source.path.is_some());
    let guard = a
        .state
        .audio
        .source
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let save = SaveProject {
        name: a.name.clone(),
        created_ms: Some(a.created_ms),
        source: a.source.clone(),
        setup,
        layout,
        results: Vec::new(),
        notes: a.notes.clone(),
        compare: snapshots,
        pcm: if can_reference { None } else { guard.as_ref() },
    };

    if let Some(parent) = std::path::Path::new(path)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("could not create {}: {err}", parent.display()))?;
    }
    let file =
        std::fs::File::create(path).map_err(|err| format!("could not create {path}: {err}"))?;
    write_project(
        std::io::BufWriter::new(file),
        &save,
        crate::recent::now_ms(),
    )
    .map_err(|err| format!("could not write {path}: {err}"))?;
    // stdout stays pure JSONL; the saved path is a note for the shell.
    eprintln!("hey-listen: saved {path}");
    Ok(())
}
