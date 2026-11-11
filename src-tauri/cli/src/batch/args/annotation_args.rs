//! `annotations` operation parsing: `--add` / `--get` / `--update --set` / `--delete`.
//!
//! Split out of [`super`] to keep each file inside the source-size budget.

use serde_json::Value;

use super::super::inputs::split_kv;
use super::super::types::AnnotationsOp;
use super::source::ArgSource;
use super::{string, strings};

/// Which `annotations` operation the flags select (at most one).
pub(super) fn annotation_op(matches: &dyn ArgSource) -> Result<AnnotationsOp, String> {
    let add = string(matches, "add");
    let get = string(matches, "get");
    let update = string(matches, "update");
    let delete = string(matches, "delete");
    let set = parse_annotation_sets(&strings(matches, "set"))?;
    let chosen = usize::from(add.is_some())
        + usize::from(get.is_some())
        + usize::from(update.is_some())
        + usize::from(delete.is_some());
    if chosen > 1 {
        return Err("annotations takes one operation: --add / --get / --update / --delete".into());
    }
    if let Some(file) = add {
        return Ok(AnnotationsOp::Add { file });
    }
    if let Some(id) = get {
        return Ok(AnnotationsOp::Get { id });
    }
    if let Some(id) = update {
        return Ok(AnnotationsOp::Update { id, patch: set });
    }
    if let Some(id) = delete {
        return Ok(AnnotationsOp::Delete { id });
    }
    if !set.is_empty() {
        return Err("`--set` needs `--update <ID>`".into());
    }
    Ok(AnnotationsOp::List)
}

/// The `--set FIELD=VALUE` list for `annotations --update`.
///
/// Fields: `title`, `body`, `timeSecs` (`time` / `at`), `range` (`start,end` seconds, an
/// object, or `none`) and `tool` (an analyzer id or `none`).
fn parse_annotation_sets(tokens: &[String]) -> Result<Vec<(String, Value)>, String> {
    let mut sets = Vec::new();
    for token in tokens {
        let (key, value) = split_kv(token)?;
        let known = matches!(
            key.as_str(),
            "title" | "body" | "timeSecs" | "time" | "at" | "range" | "tool"
        );
        if !known {
            return Err(format!("unknown annotation field: {key}"));
        }
        sets.push((key, value));
    }
    Ok(sets)
}
