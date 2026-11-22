//! Per-tool implementations for the headless session.
//!
//! These are the arms of [`HeadlessSession::dispatch`] that need more than a line:
//! reading the observable state, installing a filter, opening a source file,
//! rendering a synth graph, and running an analyzer.

use serde_json::{json, Map, Value};

use crate::audio::analysis;
use crate::audio::analyzers::{self, AnalyzerId, ToolId};
use crate::audio::decode;
use crate::audio::graph::{self, GraphSpec};
use crate::state::SourceData;

use super::args::{self, analyzer, tool_id};
use super::cache::CacheKey;
use super::HeadlessSession;

impl HeadlessSession {
    /// Open (or focus) a Workbench tab. Headless has no webview, so this **records**
    /// the tab in the project's `SETUP.openTools`: `get_state.openTools` reports it,
    /// `save_project` writes it, and the app opens it when the project loads. The id
    /// is validated against the real tool list, so a typo fails here rather than at
    /// save time.
    pub(super) fn open_tool(&mut self, args: &Value) -> Result<Value, String> {
        let id = tool_id(args)?;
        if !self.open_tools.contains(&id) {
            self.open_tools.push(id);
        }
        Ok(json!({ "openTools": self.open_tools }))
    }

    /// Close a Workbench tab by id — headless, remove it from `SETUP.openTools`.
    pub(super) fn close_tool(&mut self, args: &Value) -> Result<Value, String> {
        let id = tool_id(args)?;
        self.open_tools.retain(|open| *open != id);
        Ok(json!({ "openTools": self.open_tools }))
    }

    /// The observable state an agent reads (mirrors the GUI's `get_state`, plus
    /// `headless: true`).
    pub(super) fn get_state(&self) -> Value {
        let filter_enabled = self
            .state
            .audio
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .is_some();
        let project_name = self
            .project_name
            .clone()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| self.name.clone());
        json!({
            "headless": true,
            "server": {
                "mode": "headless",
                "version": env!("CARGO_PKG_VERSION"),
            },
            "project": {
                "name": if project_name.is_empty() { Value::Null } else { Value::String(project_name) },
                "path": self.project_path.clone().map(Value::String).unwrap_or(Value::Null),
                "dirty": false,
            },
            "source": self.source_summary(),
            "window": { "start": self.window.0, "end": self.window.1 },
            "view": { "start": self.view.0, "end": self.view.1 },
            "params": serde_json::to_value(&self.params).unwrap_or(Value::Null),
            "toolOptions": self.tool_options(),
            "openTools": self.open_tools,
            // What `compare_analysis { saved: true }` can use (M25.C/M25.D), in the
            // same compact shape `list_projects` reports for an open project.
            "savedComparisons": self.state.saved_comparison_infos(),
            "filter": { "enabled": filter_enabled, "error": Value::Null },
            "output": { "gain": 1.0, "device": Value::Null },
        })
    }

    /// One tool's effective options: its declared defaults overlaid with the values the
    /// agent set. Unset fields (`null` in the stored `ToolOptions`) are omitted.
    pub(super) fn options_for(&self, tool: AnalyzerId) -> Value {
        Value::Object(analyzers::effective_options(tool, self.options.get(&tool)))
    }

    /// Every analyzer's effective options, so `get_state` reports the defaults (not just
    /// the tools the agent touched) — mirroring the GUI's `toolOptions`.
    fn tool_options(&self) -> Value {
        let mut map = Map::new();
        for analyzer in analyzers::ANALYZERS.iter() {
            map.insert(analyzer.id.to_string(), self.options_for(analyzer.id));
        }
        Value::Object(map)
    }

    /// Install (or clear) the filter applied before analysis. In headless mode there is
    /// no graph editor, so `graph` is a `GraphSpec` taken directly (the same "take the
    /// graph directly" idea as [`Self::render_synth`]); `enabled: false`, a null `graph`,
    /// or an empty graph clears it.
    pub(super) fn set_filter_graph(&mut self, args: &Value) -> Result<Value, String> {
        let enabled = args.get("enabled").and_then(Value::as_bool).unwrap_or(true);
        let spec = match graph_arg(args)? {
            Some(spec) if enabled => {
                if spec.is_empty() {
                    None
                } else {
                    // Validate it compiles as a filter (one global input) before installing.
                    graph::build(&spec, 1, 48_000).map_err(|err| err.to_string())?;
                    Some(spec)
                }
            }
            _ => None,
        };
        let applied = spec.is_some();
        self.state.audio.set_filter(spec);
        // The cache key carries no filter, so *any* filter change invalidates the entries
        // (the GUI keys on a filter fingerprint instead).
        self.results.clear();
        Ok(json!({ "filter": { "enabled": applied } }))
    }

    /// The current graph as DOT (`filter` or `synth`). Headless has no editor layout,
    /// so this is the stored `GraphSpec` emitted as text.
    pub(super) fn get_graph(&self, args: &Value) -> Result<Value, String> {
        let graph = args
            .get("graph")
            .and_then(Value::as_str)
            .ok_or("`graph` is required")?
            .parse::<ToolId>()
            .map_err(|_| "`graph` must be `filter` or `synth`".to_string())?;
        let spec = match graph {
            ToolId::Filter => self
                .state
                .audio
                .filter
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .clone(),
            ToolId::Synth => self.synth.clone(),
            other => return Err(format!("`{other}` is not a graph editor")),
        };
        let dot = spec
            .as_ref()
            .map(graph::emit)
            .transpose()
            .map_err(|err| err.to_string())?;
        Ok(json!({ "graph": graph, "dot": dot, "spec": spec }))
    }

    pub(super) fn source_summary(&self) -> Value {
        let guard = self
            .state
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(source) = guard.as_ref() else {
            return Value::Null;
        };
        let channels = source.channels.max(1) as usize;
        let frames = source.samples.len() / channels;
        let rate = source.sample_rate.max(1);
        json!({
            "name": self.name,
            "sampleRate": rate,
            "channels": source.channels.max(1),
            "frames": frames,
            "duration": frames as f64 / f64::from(rate),
            "live": false,
        })
    }

    /// The source duration in seconds (0 when there is no source).
    pub(super) fn duration(&self) -> f64 {
        let guard = self
            .state
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        match guard.as_ref() {
            Some(source) => {
                let channels = source.channels.max(1) as usize;
                let frames = source.samples.len() / channels;
                frames as f64 / f64::from(source.sample_rate.max(1))
            }
            None => 0.0,
        }
    }

    pub(super) fn open_audio_file(&mut self, args: &Value) -> Result<Value, String> {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or("`path` is required")?
            .to_string();
        // Keep an absolute path so a reference project can decode the source again from
        // any working directory.
        let path = std::fs::canonicalize(&path)
            .map(|resolved| resolved.to_string_lossy().into_owned())
            .unwrap_or(path);

        let mut samples: Vec<f32> = Vec::new();
        let summary = decode::decode_file(&path, |chunk| {
            samples.extend_from_slice(chunk);
            Ok(())
        })
        .map_err(|err| err.to_string())?;

        let channels = summary.channels.max(1);
        let rate = summary.sample_rate.max(1);
        self.state.audio.set_source(Some(SourceData {
            samples,
            sample_rate: rate,
            channels,
        }));
        self.source_path = Some(path.clone());
        self.source_kind = crate::project::SourceKind::File;
        self.synth = None;
        // Cached results belong to the previous source.
        self.results.clear();
        self.name = std::path::Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&path)
            .to_string();

        let duration = self.duration();
        self.window = (0.0, duration);
        self.view = (0.0, duration);
        Ok(self.source_summary())
    }

    pub(super) fn render_synth(&mut self, args: &Value) -> Result<Value, String> {
        // The synth *editor* is UI-only, so headless `render_synth` takes the graph as
        // DOT text, a file path, or a legacy JSON `GraphSpec`; without one it re-renders
        // the last graph.
        let spec = match graph_arg(args)? {
            Some(spec) => spec,
            None => self.synth.clone().ok_or(
                "`render_synth` needs a `graph` in headless mode (there is no synth editor)",
            )?,
        };

        let seconds = args
            .get("seconds")
            .and_then(Value::as_f64)
            .unwrap_or(5.0)
            .clamp(0.01, 600.0);
        let rate = 48_000u32;
        let pcm = graph::render_mono(&spec, seconds, rate).map_err(|err| err.to_string())?;

        self.state.audio.set_source(Some(SourceData {
            samples: pcm,
            sample_rate: rate,
            channels: 1,
        }));
        self.synth = Some(spec);
        self.source_path = None;
        self.source_kind = crate::project::SourceKind::Synth;
        // Cached results belong to the previous source.
        self.results.clear();
        self.name = "Synth".to_string();

        let duration = self.duration();
        self.window = (0.0, duration);
        self.view = (0.0, duration);
        Ok(self.source_summary())
    }

    pub(super) fn run_analysis(&mut self, args: &Value) -> Result<Value, String> {
        let tool = analyzer(args, "tool")?;

        // `transient` applies `start`/`end`/`params`/`options` to this call only; the
        // default writes them back to the session (matching the GUI's stores).
        let transient = args::transient(args);
        let params = args::effective_params(&mut self.params, args, transient)?;
        let options = args::effective_options(&mut self.options, tool, args, transient)?;

        // The effective window (clamped to the source). An explicit start/end persists
        // unless the call is transient.
        let ((start, end), has_window) = args::effective_window(self.window, args, self.duration());
        if has_window && !transient {
            self.window = (start, end);
        }

        // Resolve the output mode before the (expensive) analysis so a bad request fails
        // without computing anything.
        let output = args::output_mode(args)?;

        // Reuse a result the session already holds for this exact key (D-22); a miss runs
        // the engine and files the result under that same key.
        let key = CacheKey::new(tool, start, end, &params, &options);
        let cached = self.cached_result(&key);
        let result = match cached {
            Some(result) => result,
            None => {
                let result = analysis::run_window(&self.state, tool, start, end, &params, &options)
                    .map_err(|err| err.to_string())?;
                self.store_result(&key, &result);
                result
            }
        };

        // The summary is computed from the full result, before any shaping, so it is the
        // same in all three modes.
        let summary = analysis::summarize(&result);
        let shaped = analysis::shape_result_with_preview(
            &result,
            output.shape,
            output.max_points,
            output.axis,
            output.preview_records,
        );

        // Echo the effective settings the call ran with. The result already carries the
        // `tool` tag, so it is not repeated here; `display` is a UI-only concern (a
        // no-op headless).
        let mut envelope = json!({
            "window": { "start": start, "end": end },
            "params": serde_json::to_value(&params).unwrap_or(Value::Null),
            "options": Value::Object(analyzers::effective_options(tool, Some(&options))),
            "summary": summary,
        });
        // Response-only: `result.hopSize` stays the effective hop, so say which hop was
        // asked for when the engine widened it (see `analysis::widened_hop_from`).
        if let Some(requested) = analysis::widened_hop_from(&result, &options) {
            envelope["hopWidenedFromSamples"] = json!(requested);
        }
        if let Some(value) = shaped {
            envelope["result"] = value;
        }
        Ok(envelope)
    }
}

/// The graph an agent sent: a `graphFile` path, an inline DOT string, or a legacy JSON
/// `GraphSpec`. `None` when neither key is present.
fn graph_arg(args: &Value) -> Result<Option<GraphSpec>, String> {
    if let Some(path) = args.get("graphFile").and_then(Value::as_str) {
        return graph::parse_file(path)
            .map(Some)
            .map_err(|err| format!("invalid graph file {path}: {err}"));
    }
    match args.get("graph") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => graph::parse_input(text)
            .map(Some)
            .map_err(|err| format!("invalid graph: {err}")),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|err| format!("invalid graph: {err}")),
    }
}
