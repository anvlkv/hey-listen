//! Analysis commands: the single `run_analysis` entry point.
//!
//! Thin adapter over [`crate::audio::analysis`]: it slices the analysis window from
//! the core-owned source PCM (ADR-9), conditions it exactly like preview playback
//! (mixdown → filter → resample), and runs the CPU-bound tool on the blocking pool
//! so the async workers stay free (see `docs/architecture.md` → "Analysis execution
//! model").
//!
//! The response carries the canonical **summary** beside the (shaped) result, so the
//! MCP handler, the CLI, and the analyzer tabs read the same contract; `shape` picks
//! raw arrays (`full`, what the tabs ask for), the compact form (`compact`), or no
//! result at all (`summary`). See `docs/mcp-cli-ergonomics.md`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::WebviewWindow;

use crate::audio::analysis::{
    self, AnalysisError, ResultSummary, Shape, SharedParams, ToolOptions,
};
use crate::state::window_state;

/// One `run_analysis` request: the tool id, the analysis window (source seconds),
/// the shared params, any per-tool options, and how much of the result to return
/// (`docs/data-model.md`).
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalysisRequest {
    pub tool: String,
    pub start: f64,
    pub end: f64,
    pub params: SharedParams,
    #[serde(default)]
    pub options: ToolOptions,
    /// `full` (the analyzer tabs), `compact` (the default MCP mode), or `summary`.
    #[serde(default)]
    pub shape: Shape,
    /// Decimate the raw arrays of a `full` result to at most this many points.
    #[serde(default)]
    #[ts(optional)]
    pub max_points: Option<usize>,
}

/// The command's response: the canonical summary beside the shaped result (absent in
/// `summary` mode).
#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalysisResponse {
    pub summary: ResultSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub result: Option<Value>,
}

/// One analyzer's catalog detail (the GUI MCP `get_analyzer` path): option metadata
/// and summary keys, from the same Rust catalog the headless server uses.
#[tauri::command]
pub fn analyzer_detail(id: String) -> Result<Value, String> {
    crate::audio::analyzers::detail(&id).ok_or_else(|| format!("unknown analyzer: {id}"))
}

/// Run an analysis tool over `start..end` and return its summary + result.
///
/// The slice + condition + run work lives in [`analysis::run_window`], shared with
/// the headless MCP dispatcher; here it just runs on the blocking pool so the async
/// workers stay free (see `docs/architecture.md` → "Analysis execution model").
#[tauri::command]
pub async fn run_analysis(
    window: WebviewWindow,
    request: AnalysisRequest,
) -> Result<AnalysisResponse, AnalysisError> {
    let AnalysisRequest {
        tool,
        start,
        end,
        params,
        options,
        shape,
        max_points,
    } = request;
    let state = window_state(&window);

    tauri::async_runtime::spawn_blocking(move || {
        let result = analysis::run_window(&state, &tool, start, end, &params, &options)?;
        let summary = analysis::summarize(&result);
        let result = analysis::shape_result(&result, shape, max_points);
        Ok(AnalysisResponse { summary, result })
    })
    .await
    .map_err(|err| AnalysisError::Analysis(err.to_string()))?
}
