//! Loading a project file as one side of a comparison (M25 / M25.D).
//!
//! Both windowless callers share this loader: the batch CLI (`compare A.heyl
//! B.heyl`) and headless MCP `compare_analysis` (a reference project path). Each
//! side's saved setup — window, shared params, tool options — and its compiled
//! `LAYOUT.filterSpec` condition the signal exactly as the app would, so a
//! windowless diff matches an app comparison. Nothing is written to either file.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::audio::analysis::compare::CompareSetup;
use crate::audio::analysis::{canonical_option_key, ToolOptions};
use crate::audio::analyzers::AnalyzerId;
use crate::audio::graph::{self, GraphSpec};
use crate::project::{read_project, AnalysisSetup, Note, SourceDescriptor};
use crate::state::WindowState;

/// One loaded project: its core state and the setup the diff runs with.
pub struct Side {
    /// The project file this side was read from.
    pub file: String,
    /// The project's display name (`META.name`), for a comparison side label.
    pub name: String,
    /// The project's creation time, preserved when a comparison is saved back to it.
    pub created_ms: u64,
    /// The saved `SOURCE` descriptor (for writing the owner back).
    pub source: Option<SourceDescriptor>,
    /// The saved `LAYOUT` (graphs, popouts, `filterSpec`).
    pub layout: Value,
    /// The project's annotations.
    pub notes: Vec<Note>,
    /// Whether the file actually carried `DATA` (a reference project does not).
    pub embedded: bool,
    /// The core state holding this side's PCM and filter.
    pub state: WindowState,
    /// The project's saved `SETUP`.
    pub setup: AnalysisSetup,
    /// The saved per-tool numeric options (engine keys only).
    pub options: BTreeMap<AnalyzerId, BTreeMap<String, f64>>,
    /// The (resolved) analysis window in source seconds.
    pub window: (f64, f64),
}

impl Side {
    /// This side's setup for one tool.
    pub fn setup_for(&self, tool: AnalyzerId) -> CompareSetup {
        CompareSetup {
            start: self.window.0,
            end: self.window.1,
            params: self.setup.shared.clone(),
            options: tool_options(self.options.get(&tool)),
        }
    }
}

/// Read a project, decode (or reference-decode) its PCM, and install its filter.
pub fn load_side(path: &str, filter_override: Option<&GraphSpec>) -> Result<Side, String> {
    let mut file = std::fs::File::open(path).map_err(|err| format!("cannot open {path}: {err}"))?;
    let loaded = read_project(&mut file).map_err(|err| format!("{path}: {err}"))?;
    let embedded = loaded.pcm.is_some();
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
    let name = loaded.meta.name.clone();
    let created_ms = loaded.meta.created_ms;
    let window = saved_window(&setup, source_duration(&state));
    Ok(Side {
        file: path.to_string(),
        name,
        created_ms,
        source: loaded.source,
        layout: loaded.layout,
        notes: loaded.notes,
        embedded,
        state,
        options: setup.tool_options.clone(),
        setup,
        window,
    })
}

/// A state's source duration in seconds (`0` with no source).
pub fn source_duration(state: &WindowState) -> f64 {
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
pub fn saved_window(setup: &AnalysisSetup, duration: f64) -> (f64, f64) {
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

/// A saved tool's numeric options, keeping only the engine keys.
pub fn tool_options(values: Option<&BTreeMap<String, f64>>) -> ToolOptions {
    let Some(values) = values else {
        return ToolOptions::default();
    };
    let mut map: serde_json::Map<String, Value> = values
        .iter()
        .filter(|(key, _)| canonical_option_key(key).is_some())
        .map(|(key, value)| (key.clone(), serde_json::json!(value)))
        .collect();
    // A saved project stores every option as `f64`; count-valued keys must be integers
    // before `ToolOptions` deserializes them.
    crate::audio::analysis::compare::align::coerce_option_numbers(&mut map);
    serde_json::from_value(Value::Object(map)).unwrap_or_default()
}
