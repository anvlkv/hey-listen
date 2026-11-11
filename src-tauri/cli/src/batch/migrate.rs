//! `migrate` — upgrade `.heyl` project files to the current format version (M37).
//!
//! This is the **script surface** of the migration chain: it reads with `read_project` (the
//! same loader the app uses, which migrates the payloads in memory through
//! `project::migrate`) and writes with `write_project_atomic`, so bulk upgrades and an app
//! save cannot diverge. See `docs/project-file-format.md` → Migrations and ADR-32.
//!
//! A file already at the current version is left **untouched** (no rewrite, no backup)
//! unless `--embed` grows a reference project into a full copy. A rewritten file keeps a
//! `.bak` sibling unless `--no-backup`. Analysis results are dropped by the upgrade itself
//! (they are a cache); source, setup, layout, annotations, comparisons and audio survive.

use std::fs::File;
use std::io::Write;
use std::path::Path;

use serde_json::{json, Value};

use hey_listen_lib::project::{
    decode_reference, read_project, write_project_atomic, SaveProject, VERSION,
};

use super::output::emit;
use super::types::{Command, Request};

/// Run `migrate` over every given file, one JSON line per file.
pub(super) fn run_migrate(request: &Request, out: &mut impl Write) -> i32 {
    let Command::Migrate {
        paths,
        embed,
        backup,
    } = &request.command
    else {
        return 0;
    };
    let now = hey_listen_lib::recent::now_ms();
    let mut code = 0;
    for path in paths {
        match migrate_one(path, *embed, *backup, now) {
            Ok(record) => emit(out, &record, false),
            Err(error) => {
                emit(out, &json!({ "file": path, "error": error }), false);
                code = 1;
            }
        }
    }
    code
}

/// Upgrade one file, returning its report record.
fn migrate_one(path: &str, embed: bool, backup: bool, now: u64) -> Result<Value, String> {
    let mut file = File::open(path).map_err(|err| format!("{path}: {err}"))?;
    let mut loaded = read_project(&mut file).map_err(|err| format!("{path}: {err}"))?;
    let from_version = loaded.format_version;
    let migrated = loaded.upgraded_from.is_some();
    // A reference project stays a reference: `--embed` is the only way to grow it into a
    // full copy, and it decodes the `SOURCE` path exactly as the loader would.
    let grew = embed && loaded.pcm.is_none();
    if grew {
        loaded.pcm = Some(decode_reference(loaded.source.as_ref()).ok_or_else(|| {
            format!(
                "{path}: cannot embed the source (the referenced file is missing or \
                 cannot be decoded)"
            )
        })?);
    }
    let rewritten = migrated || grew;
    let backup_path = if rewritten {
        let backup_path = if backup {
            Some(write_backup(path)?)
        } else {
            None
        };
        write_project_atomic(Path::new(path), &SaveProject::from_loaded(&loaded), now)
            .map_err(|err| format!("could not rewrite {path}: {err}"))?;
        backup_path
    } else {
        None
    };
    Ok(json!({
        "file": path,
        "fromVersion": from_version,
        "toVersion": VERSION,
        "migrated": migrated,
        "embedded": loaded.pcm.is_some(),
        "backup": backup_path,
        "dropped": loaded.dropped.iter().map(ToString::to_string).collect::<Vec<_>>(),
    }))
}

/// Copy the project beside itself (`song.heyl` → `song.heyl.bak`) before it is rewritten.
fn write_backup(path: &str) -> Result<String, String> {
    let backup = format!("{path}.bak");
    std::fs::copy(path, &backup).map_err(|err| format!("could not back up {path}: {err}"))?;
    Ok(backup)
}
