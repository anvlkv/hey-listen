//! `annotations` — list, get, add, update or delete a saved project's annotations.
//!
//! Reading is read-only. Mutations (`--add`, `--update`, `--delete`) append, patch or
//! remove an annotation and write the project back **atomically** (a sibling temp file renamed
//! over it), preserving the source, setup, layout and saved comparisons. An open app does
//! not watch the file, so reload it after an external edit.
//!
//! `--update <ID> --set FIELD=VALUE` takes `title`, `body`, `timeSecs` (`time` / `at`),
//! `range` (`start,end` seconds, an object, or `none`) and `tool` (an analyzer id or
//! `none`). Values use `K=V` parsing: `none` / `null` clears an optional field.

use std::fs::File;
use std::io::Write;
use std::path::Path;

use serde_json::{json, Value};

use hey_listen_lib::project::{
    read_project, write_project_atomic, AnalysisWindow, Annotation, LoadedProject, SaveProject,
};

use super::output::emit;
use super::types::AnnotationsOp;

/// Run one `annotations` operation.
pub(super) fn run_annotations(
    path: &str,
    json: bool,
    full: bool,
    op: &AnnotationsOp,
    to: Option<&str>,
    out: &mut impl Write,
) -> i32 {
    match op {
        AnnotationsOp::List => list_annotations(path, json, full, out),
        AnnotationsOp::Add { file } => add_annotations(path, file, to, out),
        AnnotationsOp::Get { id } => get_annotation(path, id, out),
        AnnotationsOp::Update { id, patch } => update_annotation(path, id, patch, to, out),
        AnnotationsOp::Delete { id } => delete_annotation(path, id, to, out),
    }
}

fn list_annotations(path: &str, json: bool, full: bool, out: &mut impl Write) -> i32 {
    let mut annotations = match load(path) {
        Ok(loaded) => loaded.annotations,
        Err(message) => return fail(out, path, &message),
    };
    annotations.sort_by(|a, b| a.time_secs.total_cmp(&b.time_secs));

    for annotation in &annotations {
        if json {
            // The body is project data, and what a reader extracts from it (tags, notes)
            // often sits at its **end**: never silently replace it with an excerpt.
            // `--full` widens the *table* label only (audit / hey-listen-report §3.2).
            emit(
                out,
                &serde_json::to_value(annotation).unwrap_or(Value::Null),
                false,
            );
        } else {
            let time = match &annotation.range {
                Some(range) => format!("{:.3}–{:.3}", range.start_secs, range.end_secs),
                None => format!("{:.3}", annotation.time_secs),
            };
            let label = match annotation.title.as_deref() {
                Some(title) if !title.is_empty() => title.to_string(),
                _ if full => annotation.body.replace('\n', " "),
                _ => excerpt(&annotation.body),
            };
            let values = annotation
                .values
                .as_ref()
                .map(|v| v.text.as_str())
                .unwrap_or("");
            let _ = writeln!(
                out,
                "{time}\t{}\t{label}\t{values}",
                annotation
                    .tool
                    .map(Into::<&'static str>::into)
                    .unwrap_or("-"),
            );
        }
    }
    0
}

/// Print one annotation by id, with the full body and frozen values.
fn get_annotation(path: &str, id: &str, out: &mut impl Write) -> i32 {
    let loaded = match load(path) {
        Ok(loaded) => loaded,
        Err(message) => return fail(out, path, &message),
    };
    let Some(annotation) = loaded
        .annotations
        .iter()
        .find(|annotation| annotation.id == id)
    else {
        return fail(out, path, &format!("no annotation with id `{id}`"));
    };
    emit(
        out,
        &serde_json::to_value(annotation).unwrap_or(Value::Null),
        false,
    );
    0
}

/// Append the annotations in `add_path` to the project, in place or to `to`.
fn add_annotations(path: &str, add_path: &str, to: Option<&str>, out: &mut impl Write) -> i32 {
    let now = hey_listen_lib::recent::now_ms();
    let items = match super::inputs::read_annotations(add_path) {
        Ok(items) => items,
        Err(message) => return fail(out, path, &message),
    };
    let added = match hey_listen_lib::project::annotations::parse_annotations(
        Some(&Value::Array(items)),
        now,
    ) {
        Ok(annotations) => annotations,
        Err(message) => return fail(out, path, &message),
    };
    let mut loaded = match load(path) {
        Ok(loaded) => loaded,
        Err(message) => return fail(out, path, &message),
    };

    let count = added.len();
    loaded.annotations.extend(added);
    let target = to.unwrap_or(path);
    if let Err(message) = write_atomic(&loaded, target, now) {
        return fail(out, path, &message);
    }
    emit(
        out,
        &json!({ "path": target, "added": count, "annotations": loaded.annotations.len() }),
        false,
    );
    0
}

/// Patch one annotation (`--set FIELD=VALUE`) and write the project back.
fn update_annotation(
    path: &str,
    id: &str,
    patch: &[(String, Value)],
    to: Option<&str>,
    out: &mut impl Write,
) -> i32 {
    let now = hey_listen_lib::recent::now_ms();
    let mut loaded = match load(path) {
        Ok(loaded) => loaded,
        Err(message) => return fail(out, path, &message),
    };
    let Some(index) = loaded
        .annotations
        .iter()
        .position(|annotation| annotation.id == id)
    else {
        return fail(out, path, &format!("no annotation with id `{id}`"));
    };
    if let Err(message) = apply_patch(&mut loaded.annotations[index], patch, now) {
        return fail(out, path, &message);
    }
    let annotation = serde_json::to_value(&loaded.annotations[index]).unwrap_or(Value::Null);
    let target = to.unwrap_or(path);
    if let Err(message) = write_atomic(&loaded, target, now) {
        return fail(out, path, &message);
    }
    emit(
        out,
        &json!({ "path": target, "annotation": annotation, "annotations": loaded.annotations.len() }),
        false,
    );
    0
}

/// Remove one annotation by id and write the project back.
fn delete_annotation(path: &str, id: &str, to: Option<&str>, out: &mut impl Write) -> i32 {
    let now = hey_listen_lib::recent::now_ms();
    let mut loaded = match load(path) {
        Ok(loaded) => loaded,
        Err(message) => return fail(out, path, &message),
    };
    let before = loaded.annotations.len();
    loaded.annotations.retain(|annotation| annotation.id != id);
    if loaded.annotations.len() == before {
        return fail(out, path, &format!("no annotation with id `{id}`"));
    }
    let target = to.unwrap_or(path);
    if let Err(message) = write_atomic(&loaded, target, now) {
        return fail(out, path, &message);
    }
    emit(
        out,
        &json!({ "path": target, "deleted": id, "annotations": loaded.annotations.len() }),
        false,
    );
    0
}

/// Apply `--set` fields to an annotation; `none` / `null` clears an optional field.
fn apply_patch(
    annotation: &mut Annotation,
    patch: &[(String, Value)],
    now: u64,
) -> Result<(), String> {
    for (key, value) in patch {
        match key.as_str() {
            "title" => {
                annotation.title = match value {
                    Value::Null => None,
                    Value::String(text) if text.is_empty() => None,
                    Value::String(text) => Some(text.clone()),
                    _ => return Err("`title` must be a string or none".to_string()),
                }
            }
            "body" => {
                annotation.body = match value {
                    Value::String(text) => text.clone(),
                    Value::Null => String::new(),
                    _ => return Err("`body` must be a string".to_string()),
                }
            }
            "timeSecs" | "time" | "at" => {
                annotation.time_secs = value
                    .as_f64()
                    .ok_or_else(|| "`timeSecs` must be a number".to_string())?;
            }
            "tool" => {
                annotation.tool = match value {
                    Value::Null => None,
                    Value::String(text) => Some(
                        text.parse()
                            .map_err(|_| format!("unknown analyzer: {text}"))?,
                    ),
                    _ => return Err("`tool` must be an analyzer id or none".to_string()),
                }
            }
            "range" => annotation.range = parse_range(value)?,
            other => return Err(format!("unknown annotation field: {other}")),
        }
    }
    annotation.updated_ms = now;
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

/// Write `loaded` to `target` through the shared atomic helper, so a failure cannot
/// truncate the original project.
fn write_atomic(loaded: &LoadedProject, target: &str, now: u64) -> Result<(), String> {
    let save = SaveProject {
        name: loaded.meta.name.clone(),
        created_ms: Some(loaded.meta.created_ms),
        source: loaded.source.clone(),
        setup: loaded.setup.clone(),
        layout: loaded.layout.clone(),
        results: loaded.results.clone(),
        annotations: loaded.annotations.clone(),
        compare: loaded.compare.clone(),
        pcm: loaded.pcm.as_ref(),
    };
    write_project_atomic(Path::new(target), &save, now)
        .map_err(|err| format!("could not replace {target}: {err}"))
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
