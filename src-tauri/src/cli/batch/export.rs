//! `--out` / `--format csv` writing: render one tool through the shared headless
//! `export_analysis` tool, then write the file (and its CSV sidecar) at the requested
//! target.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::mcp::dispatch::HeadlessSession;

use super::output::emit;
use super::types::{OutputTarget, Request};

/// Export one tool's result, writing to `--out` or printing CSV to stdout.
///
/// Returns `Err(())` for the caller's `--fail-fast` bookkeeping; the error line is
/// already emitted.
pub(super) fn run_export(
    session: &mut HeadlessSession,
    request: &Request,
    tool: &str,
    label: &str,
    start: Option<f64>,
    end: Option<f64>,
    out: &mut impl Write,
) -> Result<(), ()> {
    let mut args = json!({ "tool": tool, "format": request.format.as_str() });
    if let Some(start) = start {
        args["start"] = json!(start);
    }
    if let Some(end) = end {
        args["end"] = json!(end);
    }

    let rendered = match session.dispatch("export_analysis", args) {
        Ok(value) => value,
        Err(message) => {
            emit(
                out,
                &json!({ "file": label, "tool": tool, "error": message }),
                false,
            );
            return Err(());
        }
    };

    let text = rendered["text"].as_str().unwrap_or_default();
    let Some(target) = &request.out else {
        // Validated to be exactly one result, so the CSV is the whole document.
        let _ = out.write_all(text.as_bytes());
        if !text.ends_with('\n') {
            let _ = writeln!(out);
        }
        return Ok(());
    };

    let file_name = rendered["fileName"].as_str().unwrap_or("export");
    let path = match target {
        OutputTarget::File(path) => PathBuf::from(path),
        OutputTarget::Dir(dir) => unique(Path::new(dir).join(file_name)),
    };
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                emit(
                    out,
                    &json!({ "file": label, "tool": tool, "error": format!("cannot create {}: {err}", parent.display()) }),
                    false,
                );
                return Err(());
            }
        }
    }
    if let Err(err) = std::fs::write(&path, text) {
        emit(
            out,
            &json!({ "file": label, "tool": tool, "error": format!("cannot write {}: {err}", path.display()) }),
            false,
        );
        return Err(());
    }

    // CSV carries its provenance in a sidecar (`docs/exports.md`).
    let sidecar_path = rendered["sidecar"].as_str().and_then(|sidecar| {
        let meta = path.with_extension("meta.json");
        std::fs::write(&meta, sidecar).ok().map(|()| meta)
    });

    let mut confirmation = json!({
        "file": label,
        "tool": tool,
        "format": request.format.as_str(),
        "path": path.to_string_lossy(),
    });
    if let Some(sidecar_path) = sidecar_path {
        confirmation["sidecarPath"] = Value::from(sidecar_path.to_string_lossy().into_owned());
    }
    emit(out, &confirmation, false);
    Ok(())
}

/// A directory target never overwrites an earlier run's file: `a.csv`, `a-2.csv`, …
fn unique(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("export")
        .to_string();
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_string);
    (2..)
        .map(|index| match &extension {
            Some(extension) => dir.join(format!("{stem}-{index}.{extension}")),
            None => dir.join(format!("{stem}-{index}")),
        })
        .find(|candidate| !candidate.exists())
        .unwrap_or(path)
}
