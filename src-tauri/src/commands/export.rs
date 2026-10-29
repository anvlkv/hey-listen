//! Export output plumbing (M12): render an analyzer result into an export, pick a
//! destination, and write text or bytes to a user-chosen path.
//!
//! The renderer itself lives in [`crate::export`] and is shared with the MCP server
//! and the batch CLI, so every surface writes the same JSON envelope and CSV. This
//! module only adapts it to IPC and the native dialogs. See `docs/exports.md`.

use std::collections::BTreeMap;
use std::path::Path;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::audio::analysis::{self, AnalysisError, SharedParams, ToolOptions};
use crate::audio::analyzers;
use crate::export::{self, ExportContext, ExportFormat, ExportSource, RenderedExport};
use crate::project::AnalysisWindow;
use crate::state::{window_state, WindowState};

/// One `export_analysis` request: the same settings `run_analysis` takes, plus the
/// source provenance and the format.
///
/// The result is **recomputed** here rather than sent back from the webview: the
/// export then reflects the settings at the moment it is written, and the frontend
/// does not have to ship a full result payload back over IPC.
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportArgs {
    pub tool: String,
    pub start: f64,
    pub end: f64,
    pub params: SharedParams,
    #[serde(default)]
    pub options: ToolOptions,
    pub source: ExportSource,
    /// `json` (default) or `csv`.
    #[serde(default)]
    pub format: ExportFormat,
}

/// A rendered export, ready to be written by the frontend.
#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportedAnalysis {
    pub tool: String,
    pub format: ExportFormat,
    /// `<source stem>.<tool>.<ext>` — the suggested file name.
    pub file_name: String,
    /// The file contents (the JSON envelope or the CSV).
    pub text: String,
    /// CSV only: the provenance JSON for the `.meta.json` sidecar.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sidecar: Option<String>,
}

/// "Export all open analyses": every tab's settings, one shared source/window.
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportAllArgs {
    pub dir: String,
    pub tools: Vec<String>,
    /// `json` / `csv`; empty means both.
    #[serde(default)]
    pub formats: Vec<ExportFormat>,
    pub start: f64,
    pub end: f64,
    pub params: SharedParams,
    /// Per-tool options (each tab's effective engine values).
    #[serde(default)]
    pub options: BTreeMap<String, ToolOptions>,
    pub source: ExportSource,
}

/// One file written by an "export all".
#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportedFile {
    pub tool: String,
    pub format: ExportFormat,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sidecar_path: Option<String>,
}

/// An "export all" result.
#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportedAll {
    pub dir: String,
    pub files: Vec<ExportedFile>,
}

/// Run an analyzer and render its result as an export (no file is written).
#[tauri::command]
pub async fn export_analysis(
    window: WebviewWindow,
    args: ExportArgs,
) -> Result<ExportedAnalysis, AnalysisError> {
    let state = window_state(&window);
    tauri::async_runtime::spawn_blocking(move || {
        let rendered = render_for(&state, &args)?;
        Ok(ExportedAnalysis {
            tool: args.tool,
            format: args.format,
            file_name: rendered.file_name,
            text: rendered.text,
            sidecar: rendered.sidecar,
        })
    })
    .await
    .map_err(|err| AnalysisError::Analysis(err.to_string()))?
}

/// Run every requested tool and write each export (plus CSV sidecars) to `dir`.
#[tauri::command]
pub async fn export_all(
    window: WebviewWindow,
    args: ExportAllArgs,
) -> Result<ExportedAll, AnalysisError> {
    let state = window_state(&window);
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&args.dir)
            .map_err(|err| AnalysisError::Analysis(format!("cannot create {}: {err}", args.dir)))?;
        let formats = if args.formats.is_empty() {
            vec![ExportFormat::Json, ExportFormat::Csv]
        } else {
            args.formats.clone()
        };
        let mut files = Vec::new();
        for tool in &args.tools {
            let options = args.options.get(tool).cloned().unwrap_or_default();
            for &format in &formats {
                let request = ExportArgs {
                    tool: tool.clone(),
                    start: args.start,
                    end: args.end,
                    params: args.params.clone(),
                    options: options.clone(),
                    source: args.source.clone(),
                    format,
                };
                let rendered = render_for(&state, &request)?;
                let path = Path::new(&args.dir).join(&rendered.file_name);
                std::fs::write(&path, &rendered.text).map_err(|err| {
                    AnalysisError::Analysis(format!("cannot write {}: {err}", path.display()))
                })?;
                let mut sidecar_path = None;
                if let Some(sidecar) = &rendered.sidecar {
                    let meta = path.with_extension("meta.json");
                    std::fs::write(&meta, sidecar).map_err(|err| {
                        AnalysisError::Analysis(format!("cannot write {}: {err}", meta.display()))
                    })?;
                    sidecar_path = Some(meta.to_string_lossy().into_owned());
                }
                files.push(ExportedFile {
                    tool: tool.clone(),
                    format,
                    path: path.to_string_lossy().into_owned(),
                    sidecar_path,
                });
            }
        }
        Ok(ExportedAll {
            dir: args.dir,
            files,
        })
    })
    .await
    .map_err(|err| AnalysisError::Analysis(err.to_string()))?
}

/// The one place an export is computed, shared by `export_analysis` / `export_all`.
fn render_for(state: &WindowState, args: &ExportArgs) -> Result<RenderedExport, AnalysisError> {
    let result = analysis::run_window(
        state,
        &args.tool,
        args.start,
        args.end,
        &args.params,
        &args.options,
    )?;
    let context = ExportContext {
        tool: args.tool.clone(),
        source: args.source.clone(),
        window: AnalysisWindow {
            start_secs: args.start,
            end_secs: args.end,
        },
        params: args.params.clone(),
        options: analyzers::effective_options(&args.tool, Some(&args.options)),
    };
    Ok(export::render(
        &context,
        &result,
        args.format,
        crate::recent::now_ms(),
    ))
}

/// Pick where to save an export (native dialog), filtered by `kind`
/// (`json` / `csv` / `png`).
#[tauri::command]
pub async fn pick_save_path(app: AppHandle, kind: String, default_name: String) -> Option<String> {
    let (title, filter, extensions) = match kind.as_str() {
        "csv" => ("Export CSV", "CSV", &["csv"][..]),
        "png" => ("Export chart image", "PNG image", &["png"][..]),
        "heyltemplate" => (
            "Export template",
            "Hey Listen template",
            &["heyltemplate"][..],
        ),
        _ => ("Export JSON", "JSON", &["json"][..]),
    };
    app.dialog()
        .file()
        .set_title(title)
        .add_filter(filter, extensions)
        .set_file_name(default_name)
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Pick a destination folder (for "export all open analyses").
#[tauri::command]
pub async fn pick_directory(app: AppHandle, title: Option<String>) -> Option<String> {
    app.dialog()
        .file()
        .set_title(title.unwrap_or_else(|| "Choose a folder".to_string()))
        .blocking_pick_folder()
        .and_then(|folder| folder.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Write UTF-8 text (JSON / CSV) to an absolute path.
#[tauri::command]
pub fn write_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|err| format!("cannot write {path}: {err}"))
}

/// Write binary data (a chart PNG) to an absolute path. The bytes cross IPC
/// base64-encoded — a chart is a few hundred kilobytes, well within one message.
#[tauri::command]
pub fn write_bytes(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|err| format!("invalid base64 data: {err}"))?;
    std::fs::write(&path, bytes).map_err(|err| format!("cannot write {path}: {err}"))
}
