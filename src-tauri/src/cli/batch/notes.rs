//! `notes` — list, get, add, update or delete a saved project's notes.
//!
//! Reading is read-only. Mutations (`--add`, `--update`, `--delete`) append, patch or
//! remove a note and write the project back **atomically** (a sibling temp file renamed
//! over it), preserving the source, setup, layout and saved comparisons. An open app does
//! not watch the file, so reload it after an external edit.
//!
//! `--update <ID> --set FIELD=VALUE` takes `title`, `body`, `timeSecs` (`time` / `at`),
//! `range` (`start,end` seconds, an object, or `none`) and `tool` (an analyzer id or
//! `none`). Values use `K=V` parsing: `none` / `null` clears an optional field.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use serde_json::{json, Value};

use crate::project::{
    read_project, write_project, AnalysisWindow, LoadedProject, Note, SaveProject,
};

use super::output::emit;
use super::types::NotesOp;

/// Run one `notes` operation.
pub(super) fn run_notes(
    path: &str,
    json: bool,
    full: bool,
    op: &NotesOp,
    to: Option<&str>,
    out: &mut impl Write,
) -> i32 {
    match op {
        NotesOp::List => list_notes(path, json, full, out),
        NotesOp::Add { file } => add_notes(path, file, to, out),
        NotesOp::Get { id } => get_note(path, id, out),
        NotesOp::Update { id, patch } => update_note(path, id, patch, to, out),
        NotesOp::Delete { id } => delete_note(path, id, to, out),
    }
}

fn list_notes(path: &str, json: bool, full: bool, out: &mut impl Write) -> i32 {
    let mut notes = match load(path) {
        Ok(loaded) => loaded.notes,
        Err(message) => return fail(out, path, &message),
    };
    notes.sort_by(|a, b| a.time_secs.total_cmp(&b.time_secs));

    for note in &notes {
        if json {
            let mut value = serde_json::to_value(note).unwrap_or(Value::Null);
            if !full {
                if let Some(object) = value.as_object_mut() {
                    object.insert("body".to_string(), json!(excerpt(&note.body)));
                }
            }
            emit(out, &value, false);
        } else {
            let time = match &note.range {
                Some(range) => format!("{:.3}–{:.3}", range.start_secs, range.end_secs),
                None => format!("{:.3}", note.time_secs),
            };
            let label = match note.title.as_deref() {
                Some(title) if !title.is_empty() => title.to_string(),
                _ if full => note.body.replace('\n', " "),
                _ => excerpt(&note.body),
            };
            let values = note.values.as_ref().map(|v| v.text.as_str()).unwrap_or("");
            let _ = writeln!(
                out,
                "{time}\t{}\t{label}\t{values}",
                note.tool.map(Into::<&'static str>::into).unwrap_or("-"),
            );
        }
    }
    0
}

/// Print one note by id, with the full body and frozen values.
fn get_note(path: &str, id: &str, out: &mut impl Write) -> i32 {
    let loaded = match load(path) {
        Ok(loaded) => loaded,
        Err(message) => return fail(out, path, &message),
    };
    let Some(note) = loaded.notes.iter().find(|note| note.id == id) else {
        return fail(out, path, &format!("no note with id `{id}`"));
    };
    emit(
        out,
        &serde_json::to_value(note).unwrap_or(Value::Null),
        false,
    );
    0
}

/// Append the notes in `add_path` to the project, in place or to `to`.
fn add_notes(path: &str, add_path: &str, to: Option<&str>, out: &mut impl Write) -> i32 {
    let now = crate::recent::now_ms();
    let items = match super::inputs::read_notes(add_path) {
        Ok(items) => items,
        Err(message) => return fail(out, path, &message),
    };
    let added = match crate::project::notes::parse_notes(Some(&Value::Array(items)), now) {
        Ok(notes) => notes,
        Err(message) => return fail(out, path, &message),
    };
    let mut loaded = match load(path) {
        Ok(loaded) => loaded,
        Err(message) => return fail(out, path, &message),
    };

    let count = added.len();
    loaded.notes.extend(added);
    let target = to.unwrap_or(path);
    if let Err(message) = write_atomic(&loaded, target, now) {
        return fail(out, path, &message);
    }
    emit(
        out,
        &json!({ "path": target, "added": count, "notes": loaded.notes.len() }),
        false,
    );
    0
}

/// Patch one note (`--set FIELD=VALUE`) and write the project back.
fn update_note(
    path: &str,
    id: &str,
    patch: &[(String, Value)],
    to: Option<&str>,
    out: &mut impl Write,
) -> i32 {
    let now = crate::recent::now_ms();
    let mut loaded = match load(path) {
        Ok(loaded) => loaded,
        Err(message) => return fail(out, path, &message),
    };
    let Some(index) = loaded.notes.iter().position(|note| note.id == id) else {
        return fail(out, path, &format!("no note with id `{id}`"));
    };
    if let Err(message) = apply_patch(&mut loaded.notes[index], patch, now) {
        return fail(out, path, &message);
    }
    let note = serde_json::to_value(&loaded.notes[index]).unwrap_or(Value::Null);
    let target = to.unwrap_or(path);
    if let Err(message) = write_atomic(&loaded, target, now) {
        return fail(out, path, &message);
    }
    emit(
        out,
        &json!({ "path": target, "note": note, "notes": loaded.notes.len() }),
        false,
    );
    0
}

/// Remove one note by id and write the project back.
fn delete_note(path: &str, id: &str, to: Option<&str>, out: &mut impl Write) -> i32 {
    let now = crate::recent::now_ms();
    let mut loaded = match load(path) {
        Ok(loaded) => loaded,
        Err(message) => return fail(out, path, &message),
    };
    let before = loaded.notes.len();
    loaded.notes.retain(|note| note.id != id);
    if loaded.notes.len() == before {
        return fail(out, path, &format!("no note with id `{id}`"));
    }
    let target = to.unwrap_or(path);
    if let Err(message) = write_atomic(&loaded, target, now) {
        return fail(out, path, &message);
    }
    emit(
        out,
        &json!({ "path": target, "deleted": id, "notes": loaded.notes.len() }),
        false,
    );
    0
}

/// Apply `--set` fields to a note; `none` / `null` clears an optional field.
fn apply_patch(note: &mut Note, patch: &[(String, Value)], now: u64) -> Result<(), String> {
    for (key, value) in patch {
        match key.as_str() {
            "title" => {
                note.title = match value {
                    Value::Null => None,
                    Value::String(text) if text.is_empty() => None,
                    Value::String(text) => Some(text.clone()),
                    _ => return Err("`title` must be a string or none".to_string()),
                }
            }
            "body" => {
                note.body = match value {
                    Value::String(text) => text.clone(),
                    Value::Null => String::new(),
                    _ => return Err("`body` must be a string".to_string()),
                }
            }
            "timeSecs" | "time" | "at" => {
                note.time_secs = value
                    .as_f64()
                    .ok_or_else(|| "`timeSecs` must be a number".to_string())?;
            }
            "tool" => {
                note.tool = match value {
                    Value::Null => None,
                    Value::String(text) => Some(
                        text.parse()
                            .map_err(|_| format!("unknown analyzer: {text}"))?,
                    ),
                    _ => return Err("`tool` must be an analyzer id or none".to_string()),
                }
            }
            "range" => note.range = parse_range(value)?,
            other => return Err(format!("unknown note field: {other}")),
        }
    }
    note.updated_ms = now;
    Ok(())
}

/// `range` as `start,end` seconds, an `{ startSecs, endSecs }` object, or `none`.
fn parse_range(value: &Value) -> Result<Option<AnalysisWindow>, String> {
    match value {
        Value::Null => Ok(None),
        Value::String(text) => {
            let (start, end) = text
                .split_once(',')
                .ok_or_else(|| "`range` must be `start,end` seconds or none".to_string())?;
            let start = start
                .trim()
                .parse::<f64>()
                .map_err(|_| format!("invalid range start: {start}"))?;
            let end = end
                .trim()
                .parse::<f64>()
                .map_err(|_| format!("invalid range end: {end}"))?;
            Ok(Some(AnalysisWindow {
                start_secs: start,
                end_secs: end,
            }))
        }
        Value::Object(_) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|err| format!("invalid `range`: {err}")),
        _ => Err("`range` must be `start,end` seconds, an object, or none".to_string()),
    }
}

/// Read a project container (`pcm` stays `None` for a reference project).
fn load(path: &str) -> Result<LoadedProject, String> {
    let mut file = File::open(path).map_err(|err| format!("{path}: {err}"))?;
    read_project(&mut file).map_err(|err| format!("{path}: {err}"))
}

/// Write `loaded` to `target` through a sibling temp file, so a failure cannot truncate
/// the original project.
fn write_atomic(loaded: &LoadedProject, target: &str, now: u64) -> Result<(), String> {
    let save = SaveProject {
        name: loaded.meta.name.clone(),
        created_ms: Some(loaded.meta.created_ms),
        source: loaded.source.clone(),
        setup: loaded.setup.clone(),
        layout: loaded.layout.clone(),
        results: loaded.results.clone(),
        notes: loaded.notes.clone(),
        compare: loaded.compare.clone(),
        pcm: loaded.pcm.as_ref(),
    };
    if let Some(parent) = Path::new(target)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("could not create {}: {err}", parent.display()))?;
    }
    let temp = format!("{target}.tmp");
    {
        let file = File::create(&temp).map_err(|err| format!("could not create {temp}: {err}"))?;
        write_project(BufWriter::new(file), &save, now)
            .map_err(|err| format!("could not write {temp}: {err}"))?;
    }
    std::fs::rename(&temp, target).map_err(|err| format!("could not replace {target}: {err}"))
}

fn fail(out: &mut impl Write, path: &str, message: &str) -> i32 {
    emit(out, &json!({ "file": path, "error": message }), false);
    1
}

/// A one-line excerpt of a markdown body for the table / default JSON output.
fn excerpt(body: &str) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let mut short: String = line.chars().take(60).collect();
    if line.chars().count() > 60 {
        short.push('…');
    }
    short
}
