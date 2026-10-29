//! Headless data exports (M12): `export_analysis` and `export_all`.
//!
//! Both run the same analyzer the GUI runs and render through [`crate::export`], so a
//! headless file is byte-identical to one written by the app or the batch CLI. Chart
//! PNGs need the rendered canvas and stay GUI-only.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::audio::analysis;
use crate::audio::analyzers;
use crate::export::{self, ExportContext, ExportFormat, ExportSource, RenderedExport};
use crate::project::AnalysisWindow;

use super::args::clamp_span;
use super::HeadlessSession;

impl HeadlessSession {
    /// Render one tool's current window as an export (no file is written).
    fn render_export(
        &mut self,
        tool: &str,
        format: ExportFormat,
        start: f64,
        end: f64,
    ) -> Result<RenderedExport, String> {
        if !analyzers::is_analyzer(tool) {
            return Err(format!("unknown analyzer: {tool}"));
        }
        let (start, end) = clamp_span(start, end, self.duration());
        let options = self.options.get(tool).cloned().unwrap_or_default();
        let result = analysis::run_window(&self.state, tool, start, end, &self.params, &options)
            .map_err(|err| err.to_string())?;
        let context = ExportContext {
            tool: tool.to_string(),
            source: self.export_source()?,
            window: AnalysisWindow {
                start_secs: start,
                end_secs: end,
            },
            params: self.params.clone(),
            options: analyzers::effective_options(tool, Some(&options)),
        };
        Ok(export::render(
            &context,
            &result,
            format,
            crate::recent::now_ms(),
        ))
    }

    /// The current source's provenance, or an error when nothing is loaded.
    fn export_source(&self) -> Result<ExportSource, String> {
        let guard = self
            .state
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(source) = guard.as_ref() else {
            return Err("no audio source is loaded — open a file or render a synth first".into());
        };
        let channels = source.channels.max(1);
        let frames = source.samples.len() / channels as usize;
        let rate = source.sample_rate.max(1);
        Ok(ExportSource {
            name: self.name.clone(),
            kind: if self.synth.is_some() {
                "synth".to_string()
            } else if self.source_path.is_some() {
                "file".to_string()
            } else {
                "unknown".to_string()
            },
            sample_rate: rate,
            channels,
            duration: frames as f64 / f64::from(rate),
            path: self.source_path.clone(),
        })
    }

    /// `export_analysis { tool, format?, path?, start?, end?, includeSidecar? }`.
    ///
    /// Returns the rendered `text` whether or not a `path` was given, so an agent can
    /// read the data without touching the filesystem.
    pub(super) fn export_analysis(&mut self, args: &Value) -> Result<Value, String> {
        let tool = args
            .get("tool")
            .and_then(Value::as_str)
            .ok_or("`tool` is required")?
            .to_string();
        let format = parse_format(args)?;
        let start = args
            .get("start")
            .and_then(Value::as_f64)
            .unwrap_or(self.window.0);
        let end = args
            .get("end")
            .and_then(Value::as_f64)
            .unwrap_or(self.window.1);
        let include_sidecar = args
            .get("includeSidecar")
            .and_then(Value::as_bool)
            .unwrap_or(true);

        let RenderedExport {
            file_name,
            text,
            sidecar,
            ..
        } = self.render_export(&tool, format, start, end)?;
        let mut out = json!({
            "tool": tool,
            "format": format.as_str(),
            "fileName": file_name,
        });
        if let Some(path) = args.get("path").and_then(Value::as_str) {
            std::fs::write(path, &text).map_err(|err| format!("cannot write {path}: {err}"))?;
            out["path"] = Value::from(path);
            if include_sidecar {
                if let Some(sidecar) = &sidecar {
                    let sidecar_path = sidecar_path(Path::new(path));
                    std::fs::write(&sidecar_path, sidecar)
                        .map_err(|err| format!("cannot write {}: {err}", sidecar_path.display()))?;
                    out["sidecarPath"] = Value::from(sidecar_path.to_string_lossy().into_owned());
                }
            }
        }
        if let Some(sidecar) = sidecar {
            out["sidecar"] = Value::from(sidecar);
        }
        out["text"] = Value::from(text);
        Ok(out)
    }

    /// `export_all { tools, dir, formats? }` — every requested tool to a folder.
    ///
    /// Headless there is no open-tab set, so the tool list is explicit.
    pub(super) fn export_all(&mut self, args: &Value) -> Result<Value, String> {
        let tools = args
            .get("tools")
            .and_then(Value::as_array)
            .ok_or("`tools` is required in headless mode (there are no open tabs)")?;
        let dir = args
            .get("dir")
            .and_then(Value::as_str)
            .ok_or("`dir` is required")?;
        let formats = parse_formats(args)?;
        std::fs::create_dir_all(dir).map_err(|err| format!("cannot create {dir}: {err}"))?;

        let mut files = Vec::new();
        for tool in tools.iter().filter_map(Value::as_str) {
            for &format in &formats {
                let rendered = self.render_export(tool, format, self.window.0, self.window.1)?;
                let path = Path::new(dir).join(&rendered.file_name);
                std::fs::write(&path, &rendered.text)
                    .map_err(|err| format!("cannot write {}: {err}", path.display()))?;
                let mut entry = json!({
                    "tool": tool,
                    "format": format.as_str(),
                    "path": path.to_string_lossy(),
                });
                if let Some(sidecar) = &rendered.sidecar {
                    let sidecar_path = sidecar_path(&path);
                    std::fs::write(&sidecar_path, sidecar)
                        .map_err(|err| format!("cannot write {}: {err}", sidecar_path.display()))?;
                    entry["sidecarPath"] = Value::from(sidecar_path.to_string_lossy().into_owned());
                }
                files.push(entry);
            }
        }
        Ok(json!({ "dir": dir, "files": files }))
    }
}

/// `a.csv` → `a.meta.json` (the CSV sidecar, `docs/exports.md`).
fn sidecar_path(path: &Path) -> PathBuf {
    path.with_extension("meta.json")
}

fn parse_format(args: &Value) -> Result<ExportFormat, String> {
    match args.get("format").and_then(Value::as_str) {
        None | Some("json") => Ok(ExportFormat::Json),
        Some("csv") => Ok(ExportFormat::Csv),
        Some(other) => Err(format!("unknown format: {other} (use json or csv)")),
    }
}

fn parse_formats(args: &Value) -> Result<Vec<ExportFormat>, String> {
    let Some(items) = args.get("formats").and_then(Value::as_array) else {
        return Ok(vec![ExportFormat::Json, ExportFormat::Csv]);
    };
    let mut formats = Vec::new();
    for item in items {
        let name = item.as_str().ok_or("`formats` must be strings")?;
        formats.push(match name {
            "json" => ExportFormat::Json,
            "csv" => ExportFormat::Csv,
            other => return Err(format!("unknown format: {other} (use json or csv)")),
        });
    }
    Ok(formats)
}
