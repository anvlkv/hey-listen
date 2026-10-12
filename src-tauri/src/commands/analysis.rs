//! Analysis commands: the single `run_analysis` entry point.
//!
//! Thin adapter over [`crate::audio::analysis`]: it slices the analysis window from
//! the core-owned source PCM (ADR-9), conditions it exactly like preview playback
//! (mixdown → filter → resample), and runs the CPU-bound tool on the blocking pool
//! so the async workers stay free (see `docs/architecture.md` → "Analysis execution
//! model").

use serde::Deserialize;
use tauri::WebviewWindow;

use crate::audio::analysis::{self, AnalysisError, AnalysisResult, SharedParams, ToolOptions};
use crate::state::window_state;

/// One `run_analysis` request: the tool id, the analysis window (source seconds),
/// the shared params, and any per-tool options (`docs/data-model.md`).
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
}

/// Run an analysis tool over `start..end` and return its result.
///
/// The slice + condition + run work lives in [`analysis::run_window`], shared with
/// the headless MCP dispatcher; here it just runs on the blocking pool so the async
/// workers stay free (see `docs/architecture.md` → "Analysis execution model").
#[tauri::command]
pub async fn run_analysis(
    window: WebviewWindow,
    request: AnalysisRequest,
) -> Result<AnalysisResult, AnalysisError> {
    let AnalysisRequest {
        tool,
        start,
        end,
        params,
        options,
    } = request;
    let state = window_state(&window);

    tauri::async_runtime::spawn_blocking(move || {
        analysis::run_window(&state, &tool, start, end, &params, &options)
    })
    .await
    .map_err(|err| AnalysisError::Analysis(err.to_string()))?
}
