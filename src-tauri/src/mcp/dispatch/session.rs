//! Per-tool implementations for the headless session.
//!
//! These are the arms of [`HeadlessSession::dispatch`] that need more than a line:
//! reading the observable state, installing a filter, opening a source file,
//! rendering a synth graph, and running an analyzer.

use serde_json::{json, Map, Value};

use crate::audio::analysis;
use crate::audio::analyzers::{self, AnalyzerId};
use crate::audio::decode;
use crate::audio::graph::{self, GraphSpec};
use crate::state::SourcePcm;

use super::args::{self, analyzer, tool_id};
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
        for analyzer in analyzers::ANALYZERS {
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
        let graph = args.get("graph").cloned().filter(|value| !value.is_null());
        let spec = match graph {
            Some(value) if enabled => {
                let spec: GraphSpec = serde_json::from_value(value)
                    .map_err(|err| format!("invalid filter graph: {err}"))?;
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
        Ok(json!({ "filter": { "enabled": applied } }))
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
        self.state.audio.set_source(Some(SourcePcm {
            samples,
            sample_rate: rate,
            channels,
        }));
        self.source_path = Some(path.clone());
        self.source_kind = crate::project::SourceKind::File;
        self.synth = None;
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
        // The synth *editor* is UI-only, so headless `render_synth` takes the graph
        // directly (a `GraphSpec`: `{ nodes: [{ id, kind, params }], edges: [...] }`).
        let graph_value = args
            .get("graph")
            .cloned()
            .filter(|value| !value.is_null())
            .or_else(|| {
                self.synth
                    .as_ref()
                    .and_then(|spec| serde_json::to_value(spec).ok())
            })
            .ok_or("`render_synth` needs a `graph` in headless mode (there is no synth editor)")?;
        let spec: GraphSpec = serde_json::from_value(graph_value)
            .map_err(|err| format!("invalid synth graph: {err}"))?;

        let seconds = args
            .get("seconds")
            .and_then(Value::as_f64)
            .unwrap_or(5.0)
            .clamp(0.01, 600.0);
        let rate = 48_000u32;
        let pcm = graph::render_mono(&spec, seconds, rate).map_err(|err| err.to_string())?;

        self.state.audio.set_source(Some(SourcePcm {
            samples: pcm,
            sample_rate: rate,
            channels: 1,
        }));
        self.synth = Some(spec);
        self.source_path = None;
        self.source_kind = crate::project::SourceKind::Synth;
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
        let (shape, max_points, axis) = args::output_mode(args)?;

        let result = analysis::run_window(&self.state, tool, start, end, &params, &options)
            .map_err(|err| err.to_string())?;

        // The summary is computed from the full result, before any shaping, so it is the
        // same in all three modes.
        let summary = analysis::summarize(&result);
        let shaped = analysis::shape_result_with(&result, shape, max_points, axis);

        // Echo the effective settings the call ran with. The result already carries the
        // `tool` tag, so it is not repeated here; `display` is a UI-only concern (a
        // no-op headless).
        let mut envelope = json!({
            "window": { "start": start, "end": end },
            "params": serde_json::to_value(&params).unwrap_or(Value::Null),
            "options": Value::Object(analyzers::effective_options(tool, Some(&options))),
            "summary": summary,
        });
        if let Some(value) = shaped {
            envelope["result"] = value;
        }
        Ok(envelope)
    }
}
