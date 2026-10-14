//! The headless MCP dispatcher: the engine subset, with no window.
//!
//! `heylisten-mcp --headless` (or the auto-detected fallback) runs a **core-native**
//! MCP server over stdio. It owns one [`WindowState`] — the source PCM, the filter,
//! and the preview player — plus the analysis setup the GUI keeps in its frontend
//! stores, and answers each tool by calling the **same engine functions** the GUI
//! commands call ([`crate::audio::analysis::run_window`], [`crate::audio::decode`],
//! [`crate::audio::graph`], …). So there is no second DSP path; the "same surface"
//! is the engine, not the webview.
//!
//! UI-only tools — Workbench tabs (`open_tool` / `close_tool`), editor-layout graph
//! editing (`get_graph` / `set_synth_graph`), project save/load,
//! and live preview/capture (real device I/O with no UI to configure it) — answer
//! "requires the app". `set_filter_graph` is supported headless too, but takes a
//! `GraphSpec` directly (there is no graph editor). See `docs/mcp.md`.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::audio::analysis::{self, SharedParams, ToolOptions, WindowKind};
use crate::audio::analyzers;
use crate::audio::decode;
use crate::audio::graph::{self, GraphSpec};
use crate::state::{SourcePcm, WindowState};

/// The default shared params, matching the frontend's initial store values
/// (`src/state/analysis.ts`): 2048-point Hann, 75% overlap, no resample, full band.
fn default_params() -> SharedParams {
    SharedParams {
        fft_size: 2048,
        hop: 0.25,
        randomized_overlap: false,
        window_fn: WindowKind::Hann,
        channel: None,
        resample_to: None,
        freq_min_hz: 0.0,
        freq_max_hz: 0.0,
    }
}

/// One headless project: the engine state plus the analysis setup the GUI keeps in
/// the frontend. Lives for the lifetime of the stdio session.
pub struct HeadlessSession {
    state: WindowState,
    params: SharedParams,
    /// Per-analyzer option overrides (only the keys the agent set).
    options: HashMap<String, ToolOptions>,
    /// The analysis window (source seconds).
    window: (f64, f64),
    /// The visible timeline range (source seconds) — tracked for `get_state` parity.
    view: (f64, f64),
    /// The last synth graph rendered (so a second `render_synth` can reuse it).
    synth: Option<GraphSpec>,
    name: String,
}

impl Default for HeadlessSession {
    fn default() -> Self {
        Self {
            state: WindowState::default(),
            params: default_params(),
            options: HashMap::new(),
            window: (0.0, 0.0),
            view: (0.0, 0.0),
            synth: None,
            name: String::new(),
        }
    }
}

impl HeadlessSession {
    /// Run one tool and return its result (or an error string for the agent).
    pub fn dispatch(&mut self, tool: &str, args: Value) -> Result<Value, String> {
        match tool {
            "get_state" => Ok(self.get_state()),
            "list_analyzers" => Ok(Value::Array(analyzers::list())),
            "open_audio_file" => self.open_audio_file(&args),
            "close_source" => {
                self.state.audio.clear();
                self.name.clear();
                self.window = (0.0, 0.0);
                self.view = (0.0, 0.0);
                Ok(json!({ "source": null }))
            }
            "render_synth" => self.render_synth(&args),
            "set_filter_graph" => self.set_filter_graph(&args),
            "run_analysis" => self.run_analysis(&args),
            "set_analysis_window" => {
                let start = number(&args, "start")?;
                let end = number(&args, "end")?;
                let (a, b) = clamp_span(start, end, self.duration());
                self.window = (a, b);
                Ok(json!({ "window": { "start": a, "end": b } }))
            }
            "set_view" => {
                let start = number(&args, "start")?;
                let end = number(&args, "end")?;
                let (a, b) = clamp_span(start, end, self.duration());
                self.view = (a, b);
                Ok(json!({ "view": { "start": a, "end": b } }))
            }
            "set_shared_params" => {
                let params = args.get("params").ok_or("`params` is required")?;
                merge_params(&mut self.params, params)?;
                Ok(json!({ "params": serde_json::to_value(&self.params).unwrap_or(Value::Null) }))
            }
            "set_tool_options" => {
                let tool = args
                    .get("tool")
                    .and_then(Value::as_str)
                    .ok_or("`tool` is required")?;
                let options = args
                    .get("options")
                    .and_then(Value::as_object)
                    .ok_or("`options` is required")?;
                let entry = self.options.entry(tool.to_string()).or_default();
                merge_options(entry, tool, options)?;
                Ok(json!({
                    "tool": tool,
                    "options": serde_json::to_value(self.options.get(tool)).unwrap_or(Value::Null),
                }))
            }
            "list_output_devices" => Ok(serde_json::to_value(
                crate::audio::playback::list_output_devices(),
            )
            .unwrap_or(Value::Null)),
            "list_input_devices" => {
                let devices =
                    crate::audio::capture::list_devices().map_err(|err| err.to_string())?;
                Ok(serde_json::to_value(devices).unwrap_or(Value::Null))
            }
            "list_processes" => {
                let processes =
                    crate::audio::capture::list_processes().map_err(|err| err.to_string())?;
                Ok(serde_json::to_value(processes).unwrap_or(Value::Null))
            }
            // Themes are chrome (app-level); headless has no webview to run the registry,
            // so it reports the bundled themes from `crate::themes`. Reading/writing the
            // active theme (and installed files) needs the app.
            "list_themes" => Ok(json!({
                "themes": crate::themes::builtin_summaries(),
                "installed": false,
                "active": Value::Null,
                "note": "headless lists the bundled themes; installed themes and the active mode need the app",
            })),
            "get_theme" => match args.get("id").and_then(Value::as_str) {
                Some(id) => crate::themes::builtin_summary(id)
                    .map(|theme| json!({ "theme": theme }))
                    .ok_or_else(|| format!("unknown bundled theme: {id}")),
                None => Err(
                    "reading the active theme needs the app — pass an explicit `id`".to_string(),
                ),
            },
            other => Err(format!(
                "`{other}` requires the app — headless mode runs the compute tools only \
                 (open a source, run analyzers, render synth, enumerate devices). \
                 Start Hey Listen and point the bridge at it for the full surface."
            )),
        }
    }

    /// The observable state an agent reads (mirrors the GUI's `get_state`, plus
    /// `headless: true`).
    fn get_state(&self) -> Value {
        let filter_enabled = self
            .state
            .audio
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .is_some();
        json!({
            "headless": true,
            "project": {
                "name": if self.name.is_empty() { Value::Null } else { Value::String(self.name.clone()) },
                "path": Value::Null,
                "dirty": false,
            },
            "source": self.source_summary(),
            "window": { "start": self.window.0, "end": self.window.1 },
            "view": { "start": self.view.0, "end": self.view.1 },
            "params": serde_json::to_value(&self.params).unwrap_or(Value::Null),
            "toolOptions": serde_json::to_value(&self.options).unwrap_or(Value::Null),
            "openTools": [],
            "filter": { "enabled": filter_enabled, "error": Value::Null },
            "output": { "gain": 1.0, "device": Value::Null },
        })
    }

    /// Install (or clear) the filter applied before analysis. In headless mode there is
    /// no graph editor, so `graph` is a `GraphSpec` taken directly (the same "take the
    /// graph directly" idea as [`Self::render_synth`]); `enabled: false`, a null `graph`,
    /// or an empty graph clears it.
    fn set_filter_graph(&mut self, args: &Value) -> Result<Value, String> {
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

    fn source_summary(&self) -> Value {
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
    fn duration(&self) -> f64 {
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

    fn open_audio_file(&mut self, args: &Value) -> Result<Value, String> {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or("`path` is required")?
            .to_string();

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

    fn render_synth(&mut self, args: &Value) -> Result<Value, String> {
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
        self.name = "Synth".to_string();

        let duration = self.duration();
        self.window = (0.0, duration);
        self.view = (0.0, duration);
        Ok(self.source_summary())
    }

    fn run_analysis(&mut self, args: &Value) -> Result<Value, String> {
        let tool = args
            .get("tool")
            .and_then(Value::as_str)
            .ok_or("`tool` is required")?
            .to_string();
        if !analyzers::is_analyzer(&tool) {
            return Err(format!("unknown analyzer: {tool}"));
        }

        // `transient` applies `start`/`end`/`params`/`options` to this call only; the
        // default writes them back to the session (matching the GUI's stores).
        let transient = args
            .get("transient")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        // The effective shared params: a transient patch merges into a local copy,
        // otherwise it is applied to (and persisted in) the session.
        let mut params = self.params.clone();
        if let Some(patch) = args.get("params").filter(|value| !value.is_null()) {
            if transient {
                merge_params(&mut params, patch)?;
            } else {
                merge_params(&mut self.params, patch)?;
                params = self.params.clone();
            }
        }

        // The effective per-tool options, likewise.
        let mut options = self.options.get(&tool).cloned().unwrap_or_default();
        if let Some(patch) = args.get("options").and_then(Value::as_object) {
            if transient {
                merge_options(&mut options, &tool, patch)?;
            } else {
                let entry = self.options.entry(tool.clone()).or_default();
                merge_options(entry, &tool, patch)?;
                options = self.options.get(&tool).cloned().unwrap_or_default();
            }
        }

        // The effective window (clamped to the source). An explicit start/end persists
        // unless the call is transient.
        let has_window = args.get("start").is_some() || args.get("end").is_some();
        let start = args
            .get("start")
            .and_then(Value::as_f64)
            .unwrap_or(self.window.0);
        let end = args
            .get("end")
            .and_then(Value::as_f64)
            .unwrap_or(self.window.1);
        let (start, end) = clamp_span(start, end, self.duration());
        if has_window && !transient {
            self.window = (start, end);
        }

        let result = analysis::run_window(&self.state, &tool, start, end, &params, &options)
            .map_err(|err| err.to_string())?;
        let value = serde_json::to_value(result).map_err(|err| err.to_string())?;

        let include_data = args
            .get("includeData")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let value = if include_data {
            match args.get("maxPoints").and_then(Value::as_u64) {
                Some(points) => decimate(value, points as usize),
                None => value,
            }
        } else {
            compact(value)
        };

        // Echo the effective settings the call ran with. The result already carries the
        // `tool` tag, so it is not repeated here; `display` is a UI-only concern (a
        // no-op headless).
        Ok(json!({
            "window": { "start": start, "end": end },
            "params": serde_json::to_value(&params).unwrap_or(Value::Null),
            "options": serde_json::to_value(&options).unwrap_or(Value::Null),
            "result": value,
        }))
    }
}

/// Merge a partial shared-params patch (camelCase keys), matching the frontend.
fn merge_params(params: &mut SharedParams, value: &Value) -> Result<(), String> {
    let Some(map) = value.as_object() else {
        return Err("`params` must be an object".to_string());
    };
    for (key, value) in map {
        match key.as_str() {
            "fftSize" => {
                if let Some(size) = value.as_u64() {
                    params.fft_size = size as usize;
                }
            }
            "hop" => {
                if let Some(hop) = value.as_f64() {
                    params.hop = hop;
                }
            }
            "randomizedOverlap" => {
                if let Some(flag) = value.as_bool() {
                    params.randomized_overlap = flag;
                }
            }
            "windowFn" => {
                params.window_fn = serde_json::from_value(value.clone())
                    .map_err(|err| format!("invalid `windowFn`: {err}"))?;
            }
            "channel" => {
                params.channel = if value.is_null() {
                    None
                } else {
                    value.as_u64().map(|channel| channel as usize)
                };
            }
            "resampleTo" => {
                params.resample_to = if value.is_null() {
                    None
                } else {
                    value.as_u64().map(|rate| rate as u32)
                };
            }
            "freqMinHz" => {
                if let Some(hz) = value.as_f64() {
                    params.freq_min_hz = hz;
                }
            }
            "freqMaxHz" => {
                if let Some(hz) = value.as_f64() {
                    params.freq_max_hz = hz;
                }
            }
            other => return Err(format!("unknown shared param: {other}")),
        }
    }
    Ok(())
}

/// Merge per-tool option overrides into `entry`. Only numbers are applied (the GUI
/// ignores non-numeric option values).
fn merge_options(
    entry: &mut ToolOptions,
    tool: &str,
    options: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    for (key, value) in options {
        let Some(number) = value.as_f64() else {
            continue;
        };
        match key.as_str() {
            "nMels" => entry.n_mels = Some(number as usize),
            "nMfcc" => entry.n_mfcc = Some(number as usize),
            "nBands" => entry.n_bands = Some(number as usize),
            "rolloffPercent" => entry.rolloff_percent = Some(number as f32),
            "yinThreshold" => entry.yin_threshold = Some(number as f32),
            "minF0Hz" => entry.min_f0_hz = Some(number as f32),
            "maxF0Hz" => entry.max_f0_hz = Some(number as f32),
            "barLength" => entry.bar_length = Some(number as usize),
            "windowMs" => entry.window_ms = Some(number as u32),
            "fMinHz" => entry.f_min_hz = Some(number as f32),
            "fMaxHz" => entry.f_max_hz = Some(number as f32),
            other => return Err(format!("unknown option for {tool}: {other}")),
        }
    }
    Ok(())
}

/// Read a required finite number from a tool's arguments.
fn number(args: &Value, key: &str) -> Result<f64, String> {
    args.get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("`{key}` must be a finite number"))
}

/// Clamp a span to the source and order it (matching the GUI's `clampSet`).
fn clamp_span(start: f64, end: f64, duration: f64) -> (f64, f64) {
    let mut a = start;
    let mut b = end;
    if duration > 0.0 {
        a = a.clamp(0.0, duration);
        b = b.clamp(0.0, duration);
    }
    if a > b {
        std::mem::swap(&mut a, &mut b);
    }
    (a, b)
}

/// Above this length a numeric / gapped array is summarized rather than listed.
const COMPACT_ARRAY_MIN: usize = 8;
/// Above this length any array (numeric or not) is reduced to its length.
const COMPACT_LENGTH_MIN: usize = 16;

/// Shrink a result for the agent — the same shape the GUI's `run_analysis` uses.
///
/// A long numeric array becomes `{ length, min, max, argmin, argmax }`; a long array
/// with gaps (`null`s, e.g. a pitch track's unvoiced frames) becomes
/// `{ length, nulls, min, max, argmin, argmax }` over the present numbers (so a
/// nearly-empty track is visible at a glance, and the peak can be located without
/// `includeData`); any other long array becomes `{ length }`. Objects recurse.
/// `includeData: true` returns the raw result instead. Keep this in step with the
/// frontend's `compact` in `src/state/mcp.ts`.
fn compact(value: Value) -> Value {
    match value {
        Value::Array(items) if items.len() > COMPACT_ARRAY_MIN => compact_array(items),
        Value::Array(items) => Value::Array(items.into_iter().map(compact).collect()),
        Value::Object(map) => {
            Value::Object(map.into_iter().map(|(key, v)| (key, compact(v))).collect())
        }
        other => other,
    }
}

/// Summarize an array longer than [`COMPACT_ARRAY_MIN`]: numbers and `null`s become a
/// stats object (with `nulls` when there are gaps); anything else long enough becomes
/// just its length.
fn compact_array(items: Vec<Value>) -> Value {
    let length = items.len();
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut argmin = 0usize;
    let mut argmax = 0usize;
    let mut nulls = 0usize;
    let mut present = 0usize;
    for (index, item) in items.iter().enumerate() {
        let Some(number) = item.as_f64() else {
            if item.is_null() {
                nulls += 1;
                continue;
            }
            // Not a numeric / gap array: fall back to the length (or recurse, if short).
            return if length > COMPACT_LENGTH_MIN {
                json!({ "length": length })
            } else {
                Value::Array(items.into_iter().map(compact).collect())
            };
        };
        present += 1;
        if number < min {
            min = number;
            argmin = index;
        }
        if number > max {
            max = number;
            argmax = index;
        }
    }
    // All gaps: no numbers to summarize.
    if present == 0 {
        return json!({ "length": length, "nulls": nulls });
    }
    if nulls == 0 {
        json!({
            "length": length,
            "min": min,
            "max": max,
            "argmin": argmin,
            "argmax": argmax,
        })
    } else {
        json!({
            "length": length,
            "nulls": nulls,
            "min": min,
            "max": max,
            "argmin": argmin,
            "argmax": argmax,
        })
    }
}

/// Decimate every array longer than `max_points` to at most `max_points` entries by
/// striding (keeping the first and last), so a bounded `includeData` can return a
/// representative series instead of every frame. Objects recurse. Keep this in step
/// with the frontend's `decimate` in `src/state/mcp.ts`.
fn decimate(value: Value, max_points: usize) -> Value {
    let max_points = max_points.max(2);
    match value {
        Value::Array(items) if items.len() > max_points => {
            let last = items.len() - 1;
            let step = last as f64 / (max_points - 1) as f64;
            let mut out = Vec::with_capacity(max_points);
            for index in 0..max_points {
                let source = (index as f64 * step).round() as usize;
                out.push(decimate(items[source].clone(), max_points));
            }
            Value::Array(out)
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| decimate(item, max_points))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, decimate(value, max_points)))
                .collect(),
        ),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_only_tools_require_the_app() {
        let mut session = HeadlessSession::default();
        for tool in [
            "open_tool",
            "get_graph",
            "set_synth_graph",
            "save_project",
            "preview",
            "set_theme",
            "import_theme",
            "export_theme",
        ] {
            let err = session.dispatch(tool, json!({})).unwrap_err();
            assert!(err.contains("requires the app"), "{tool}: {err}");
        }
    }

    #[test]
    fn set_filter_graph_installs_and_clears_a_filter() {
        let mut session = HeadlessSession::default();

        // A filter with a global input compiles and is reported as enabled.
        let gain = json!({
            "nodes": [
                { "id": "in", "kind": "input", "params": [] },
                { "id": "g", "kind": "gain", "params": [0.5] },
                { "id": "out", "kind": "output", "params": [] },
            ],
            "edges": [
                { "from": "in", "from_port": 0, "to": "g", "to_port": 0 },
                { "from": "g", "from_port": 0, "to": "out", "to_port": 0 },
            ],
        });
        let installed = session
            .dispatch(
                "set_filter_graph",
                json!({ "graph": gain, "enabled": true }),
            )
            .unwrap();
        assert_eq!(installed["filter"]["enabled"], true);
        assert_eq!(
            session.dispatch("get_state", json!({})).unwrap()["filter"]["enabled"],
            true
        );

        // `enabled: false` (or a null graph) bypasses it.
        session
            .dispatch("set_filter_graph", json!({ "enabled": false }))
            .unwrap();
        assert_eq!(
            session.dispatch("get_state", json!({})).unwrap()["filter"]["enabled"],
            false
        );
    }

    #[test]
    fn set_filter_graph_rejects_a_graph_without_an_input() {
        let mut session = HeadlessSession::default();
        // A synth-style graph (no `input` anchor) is not a valid filter.
        let err = session
            .dispatch(
                "set_filter_graph",
                json!({
                    "graph": {
                        "nodes": [
                            { "id": "osc", "kind": "sine", "params": [440.0] },
                            { "id": "out", "kind": "output", "params": [] },
                        ],
                        "edges": [
                            { "from": "osc", "from_port": 0, "to": "out", "to_port": 0 },
                        ],
                    },
                }),
            )
            .unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn get_state_reports_headless() {
        let mut session = HeadlessSession::default();
        let state = session.dispatch("get_state", json!({})).unwrap();
        assert_eq!(state["headless"], true);
        assert!(state["source"].is_null());
        assert_eq!(state["params"]["fftSize"], 2048);
    }

    #[test]
    fn run_analysis_without_a_source_fails() {
        let mut session = HeadlessSession::default();
        let err = session
            .dispatch("run_analysis", json!({ "tool": "spectrum" }))
            .unwrap_err();
        assert!(err.contains("no audio source"), "{err}");
    }

    #[test]
    fn shared_params_merge_partially() {
        let mut session = HeadlessSession::default();
        session
            .dispatch(
                "set_shared_params",
                json!({ "params": { "fftSize": 4096, "windowFn": "blackman" } }),
            )
            .unwrap();
        assert_eq!(session.params.fft_size, 4096);
        assert_eq!(session.params.hop, 0.25); // untouched
        assert!(matches!(session.params.window_fn, WindowKind::Blackman));
    }

    #[test]
    fn compact_collapses_long_numeric_arrays() {
        let value = json!({ "values": (0..100).map(|n| n as f64).collect::<Vec<_>>() });
        let out = compact(value);
        assert_eq!(out["values"]["length"], 100);
        assert_eq!(out["values"]["min"], 0.0);
        assert_eq!(out["values"]["max"], 99.0);
        assert_eq!(out["values"]["argmin"], 0);
        assert_eq!(out["values"]["argmax"], 99);
        assert!(out["values"].get("nulls").is_none());
    }

    #[test]
    fn compact_surfaces_gaps_in_a_long_array() {
        // A pitch track with one voiced frame out of 511 must be visible at a glance.
        let mut values: Vec<Value> = vec![Value::Null; 511];
        values[300] = json!(220.0);
        let out = compact(json!({ "values": values }));
        assert_eq!(out["values"]["length"], 511);
        assert_eq!(out["values"]["nulls"], 510);
        assert_eq!(out["values"]["min"], 220.0);
        assert_eq!(out["values"]["max"], 220.0);
        assert_eq!(out["values"]["argmin"], 300);
        assert_eq!(out["values"]["argmax"], 300);
    }

    #[test]
    fn compact_reduces_other_long_arrays_to_their_length() {
        let values: Vec<Value> = (0..20).map(|n| json!(format!("f{n}"))).collect();
        let out = compact(json!({ "labels": values }));
        assert_eq!(out["labels"]["length"], 20);
    }

    #[test]
    fn decimate_strides_keeping_first_and_last() {
        let value = json!({ "values": (0..100).map(|n| n as f64).collect::<Vec<_>>() });
        let out = decimate(value, 10);
        let values = out["values"].as_array().unwrap();
        assert_eq!(values.len(), 10);
        assert_eq!(values[0], 0.0);
        assert_eq!(values[9], 99.0);
        // A uniform stride of 11: index 1 lands on round(11) = 11.
        assert_eq!(values[1], 11.0);
        // Short arrays pass through untouched.
        let short = decimate(json!({ "values": [1.0, 2.0, 3.0] }), 10);
        assert_eq!(short["values"].as_array().unwrap().len(), 3);
    }

    /// A synth graph that renders a 440 Hz sine (`sine -> output`).
    fn sine_graph_value() -> Value {
        json!({
            "nodes": [
                { "id": "osc", "kind": "sine", "params": [440.0] },
                { "id": "out", "kind": "output", "params": [] },
            ],
            "edges": [ { "from": "osc", "from_port": 0, "to": "out", "to_port": 0 } ],
        })
    }

    #[test]
    fn run_analysis_echoes_settings_and_transient_does_not_write_back() {
        let mut session = HeadlessSession::default();
        session
            .dispatch(
                "render_synth",
                json!({ "graph": sine_graph_value(), "seconds": 1.0 }),
            )
            .unwrap();

        // Transient: params / window apply to this call only.
        let result = session
            .dispatch(
                "run_analysis",
                json!({
                    "tool": "spectrum",
                    "params": { "fftSize": 4096 },
                    "transient": true,
                    "start": 0.0,
                    "end": 0.5,
                }),
            )
            .unwrap();
        // The envelope echoes the effective settings the call ran with…
        assert_eq!(result["params"]["fftSize"], 4096);
        assert_eq!(result["window"]["end"], 0.5);
        // …but a transient call does not write them back to the session.
        assert_eq!(session.params.fft_size, 2048);
        assert_eq!(session.window, (0.0, 1.0));
        // The `tool` tag lives in the result, not duplicated on the envelope.
        assert_eq!(result["result"]["tool"], "spectrum");
        assert!(result.get("tool").is_none());

        // A non-transient call persists the override.
        let result = session
            .dispatch(
                "run_analysis",
                json!({ "tool": "spectrum", "params": { "fftSize": 4096 } }),
            )
            .unwrap();
        assert_eq!(result["params"]["fftSize"], 4096);
        assert_eq!(session.params.fft_size, 4096);
    }
}
