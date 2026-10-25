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
//!
//! The implementation is split into focused submodules: [`args`] applies the agent's
//! patch objects and [`session`] holds the per-tool implementations; [`tests`] covers
//! the table.

mod args;
mod session;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::audio::analysis::{SharedParams, ToolOptions};
use crate::audio::analyzers;
use crate::audio::graph::GraphSpec;
use crate::state::WindowState;

use args::{clamp_span, default_params, merge_options, merge_params, number};

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
            "get_analyzer" => {
                let id = args
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or("`id` is required")?;
                analyzers::detail(id).ok_or_else(|| format!("unknown analyzer: {id}"))
            }
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
                    "options": self.options_for(tool),
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
}
