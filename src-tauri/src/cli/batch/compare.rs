//! `compare <A.heyl> <B.heyl> -t TOOL` — diff the same analyzer across two project
//! files. See `docs/comparison.md` → "CLI".
//!
//! Each side's **saved setup** (window, shared params, tool options) and its compiled
//! `LAYOUT.filterSpec` condition the signal exactly as the app would, so a CLI diff
//! matches an app comparison. Nothing is written to either file.

use std::io::Write;

use serde_json::json;

use crate::audio::analysis::compare::{self as comparison, SavedComparison, SideInput, Span};
use crate::audio::analysis::{Axis, Shape};
use crate::project::side::{load_side, Side};

use super::compare_save::save_owner;
use super::output::emit;
use super::types::{Command, Request};

/// Run the comparison for every requested tool, one JSONL line each.
pub(super) fn run_compare(request: &Request, out: &mut impl Write) -> i32 {
    let Command::Compare {
        a: path_a,
        b: path_b,
        save,
        ..
    } = &request.command
    else {
        return 2;
    };
    let mut a = match load_side(path_a, request.filter.as_ref()) {
        Ok(side) => side,
        Err(message) => {
            eprintln!("hey-listen: {message}");
            return 1;
        }
    };
    let mut b = match load_side(path_b, request.filter.as_ref()) {
        Ok(side) => side,
        Err(message) => {
            eprintln!("hey-listen: {message}");
            return 1;
        }
    };
    for side in [&mut a, &mut b] {
        if let Err(message) = apply_params(side, request) {
            eprintln!("hey-listen: {message}");
            return 2;
        }
        apply_options(side, request);
    }
    apply_windows(&mut a, &mut b, request);

    let tools = super::analyze::tools_for(request);
    let shape = shape_of(request);
    let mut failed = false;
    let mut snapshots: Vec<SavedComparison> = Vec::new();
    for &tool in &tools {
        let result = comparison::compare(
            tool,
            SideInput {
                project: Some(a.file.clone()),
                state: &a.state,
                setup: a.setup_for(tool),
            },
            SideInput {
                project: Some(b.file.clone()),
                state: &b.state,
                setup: b.setup_for(tool),
            },
            request.b_offset,
        );
        match result {
            Ok(comparison) => {
                let mut value = comparison.to_value(shape, None, Axis::Array);
                value["a"]["file"] = json!(a.file);
                value["b"]["file"] = json!(b.file);
                emit(out, &value, request.pretty);
                // What a `--save` writes: the reference side as the last successful
                // comparison, exactly like the app's compare tab.
                snapshots.push(SavedComparison::from_side(
                    tool,
                    &comparison.b,
                    comparison::filter_fingerprint(&b.state),
                    request.b_offset,
                    crate::recent::now_ms(),
                    Some(b.file.clone()),
                ));
            }
            Err(err) => {
                emit(
                    out,
                    &json!({
                        "tool": tool,
                        "a": { "file": a.file },
                        "b": { "file": b.file },
                        "error": err.to_string(),
                    }),
                    request.pretty,
                );
                failed = true;
                if request.fail_fast {
                    return 1;
                }
            }
        }
    }
    if save.is_some() {
        if let Err(message) = save_owner(&a, request, snapshots) {
            eprintln!("hey-listen: {message}");
            failed = true;
        }
    }
    if failed {
        1
    } else {
        0
    }
}

fn shape_of(request: &Request) -> Shape {
    if request.summary {
        Shape::Summary
    } else if request.full {
        Shape::Full
    } else {
        Shape::Compact
    }
}

/// Apply the `-p` shared-param patches to a side.
fn apply_params(side: &mut Side, request: &Request) -> Result<(), String> {
    if request.params.is_empty() {
        return Ok(());
    }
    let mut value = serde_json::to_value(&side.setup.shared).map_err(|err| err.to_string())?;
    let Some(object) = value.as_object_mut() else {
        return Err("could not read the saved shared params".to_string());
    };
    for (key, patch) in &request.params {
        object.insert(key.clone(), patch.clone());
    }
    side.setup.shared =
        serde_json::from_value(value).map_err(|err| format!("invalid -p patch: {err}"))?;
    Ok(())
}

/// Apply the `-o` per-tool patches to a side.
fn apply_options(side: &mut Side, request: &Request) {
    for patch in &request.options {
        let Some(value) = patch.value.as_f64() else {
            continue;
        };
        side.options
            .entry(patch.tool)
            .or_default()
            .insert(patch.key.clone(), value);
    }
}

/// Apply the window overrides (`--start/--end`, per-side, then `--overlap`).
fn apply_windows(a: &mut Side, b: &mut Side, request: &Request) {
    if let Some(start) = request.start {
        a.window.0 = start;
        b.window.0 = start;
    }
    if let Some(end) = request.end {
        a.window.1 = end;
        b.window.1 = end;
    }
    if let Some(start) = request.a_start {
        a.window.0 = start;
    }
    if let Some(end) = request.a_end {
        a.window.1 = end;
    }
    if let Some(start) = request.b_start {
        b.window.0 = start;
    }
    if let Some(end) = request.b_end {
        b.window.1 = end;
    }
    if request.overlap {
        let overlap = Span::overlap(
            Span {
                start: a.window.0,
                end: a.window.1,
            },
            Span {
                start: b.window.0,
                end: b.window.1,
            },
        );
        if let Some(span) = overlap {
            a.window = (span.start, span.end);
            b.window = (span.start, span.end);
        }
    }
}
