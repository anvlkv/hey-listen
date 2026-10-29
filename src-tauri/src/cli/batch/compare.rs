//! `compare <A.heyl> <B.heyl> -t TOOL` — diff the same analyzer across two project
//! files. See `docs/comparison.md` → "CLI".
//!
//! Each side's **saved setup** (window, shared params, tool options) and its compiled
//! `LAYOUT.filterSpec` condition the signal exactly as the app would, so a CLI diff
//! matches an app comparison. Nothing is written to either file.

use std::collections::BTreeMap;
use std::io::Write;

use serde_json::{json, Value};

use crate::audio::analysis::compare::{self as comparison, CompareSetup, SideInput, Span};
use crate::audio::analysis::{canonical_option_key, Axis, Shape, ToolOptions};
use crate::audio::graph::{self, GraphSpec};
use crate::project::{read_project, AnalysisSetup};
use crate::state::WindowState;

use super::output::emit;
use super::types::{Command, Request};

/// One loaded project: its core state and the setup the diff runs with.
struct Side {
    file: String,
    state: WindowState,
    setup: AnalysisSetup,
    options: BTreeMap<String, BTreeMap<String, f64>>,
    window: (f64, f64),
}

impl Side {
    /// This side's setup for one tool.
    fn setup_for(&self, tool: &str) -> CompareSetup {
        CompareSetup {
            start: self.window.0,
            end: self.window.1,
            params: self.setup.shared.clone(),
            options: tool_options(self.options.get(tool)),
        }
    }
}

/// Run the comparison for every requested tool, one JSONL line each.
pub(super) fn run_compare(request: &Request, out: &mut impl Write) -> i32 {
    let Command::Compare {
        a: path_a,
        b: path_b,
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
    for tool in &tools {
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
        );
        match result {
            Ok(comparison) => {
                let mut value = comparison.to_value(shape, None, Axis::Array);
                value["a"]["file"] = json!(a.file);
                value["b"]["file"] = json!(b.file);
                emit(out, &value, request.pretty);
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

/// Read a project, decode (or reference-decode) its PCM, and install its filter.
fn load_side(path: &str, filter_override: Option<&GraphSpec>) -> Result<Side, String> {
    let mut file = std::fs::File::open(path).map_err(|err| format!("cannot open {path}: {err}"))?;
    let loaded = read_project(&mut file).map_err(|err| format!("{path}: {err}"))?;
    let pcm = loaded
        .pcm
        .or_else(|| crate::project::decode_reference(loaded.source.as_ref()));
    let Some(pcm) = pcm else {
        return Err(format!(
            "{path}: the project has no audio (embed it, or keep the referenced file available)"
        ));
    };
    let state = WindowState::default();
    state.audio.set_source(Some(pcm));
    state
        .audio
        .set_filter(filter_spec(path, &loaded.layout, filter_override)?);

    let setup = loaded.setup;
    let window = saved_window(&setup, source_duration(&state));
    Ok(Side {
        file: path.to_string(),
        state,
        options: setup.tool_options.clone(),
        setup,
        window,
    })
}

fn source_duration(state: &WindowState) -> f64 {
    state
        .audio
        .source
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .as_ref()
        .map(|pcm| {
            let channels = pcm.channels.max(1) as usize;
            pcm.samples.len() as f64 / channels as f64 / f64::from(pcm.sample_rate.max(1))
        })
        .unwrap_or(0.0)
}

/// The saved analysis window, falling back to the whole source.
fn saved_window(setup: &AnalysisSetup, duration: f64) -> (f64, f64) {
    let start = setup.window.start_secs.max(0.0).min(duration);
    let end = if setup.window.end_secs > start {
        setup.window.end_secs.min(duration)
    } else {
        duration
    };
    (start, end.max(start))
}

/// The compiled filter: the caller's override, else `LAYOUT.filterSpec`. A project
/// saved before that field existed compares **unfiltered**, with a one-line warning.
fn filter_spec(
    path: &str,
    layout: &Value,
    override_spec: Option<&GraphSpec>,
) -> Result<Option<GraphSpec>, String> {
    if let Some(spec) = override_spec {
        return validate_filter(path, spec);
    }
    let Some(value) = layout.get("filterSpec").filter(|value| !value.is_null()) else {
        if layout_has_composed_filter(layout) {
            eprintln!(
                "hey-listen: {path} has no LAYOUT.filterSpec (saved by an older version); \
                 comparing it unfiltered"
            );
        }
        return Ok(None);
    };
    let spec: GraphSpec = serde_json::from_value(value.clone())
        .map_err(|err| format!("{path}: invalid LAYOUT.filterSpec: {err}"))?;
    validate_filter(path, &spec)
}

fn validate_filter(path: &str, spec: &GraphSpec) -> Result<Option<GraphSpec>, String> {
    if spec.is_empty() {
        return Ok(None);
    }
    graph::build(spec, 1, 48_000)
        .map_err(|err| format!("{path}: the filter does not compile: {err}"))?;
    Ok(Some(spec.clone()))
}

/// Whether the saved **editor** layout shows a composed filter (a node that is not an
/// anchor). Older projects keep only this, so its presence is what the warning is for.
fn layout_has_composed_filter(layout: &Value) -> bool {
    layout
        .get("graphs")
        .and_then(|graphs| graphs.get("filter"))
        .and_then(|filter| filter.get("nodes"))
        .and_then(Value::as_array)
        .is_some_and(|nodes| {
            nodes.iter().any(|node| {
                node.get("data")
                    .and_then(|data| data.get("kind"))
                    .and_then(Value::as_str)
                    .is_some_and(|kind| kind != "input" && kind != "output")
            })
        })
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
            .entry(patch.tool.clone())
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

/// A saved tool's numeric options, keeping only the engine keys.
fn tool_options(values: Option<&BTreeMap<String, f64>>) -> ToolOptions {
    let Some(values) = values else {
        return ToolOptions::default();
    };
    let mut map: serde_json::Map<String, Value> = values
        .iter()
        .filter(|(key, _)| canonical_option_key(key).is_some())
        .map(|(key, value)| (key.clone(), json!(value)))
        .collect();
    // A saved project stores every option as `f64`; count-valued keys must be integers
    // before `ToolOptions` deserializes them.
    crate::audio::analysis::compare::align::coerce_option_numbers(&mut map);
    serde_json::from_value(Value::Object(map)).unwrap_or_default()
}
