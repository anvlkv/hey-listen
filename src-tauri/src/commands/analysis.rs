//! Analysis commands: the single `run_analysis` entry point.
//!
//! Thin adapter over [`crate::audio::analysis`]: it slices the analysis window from
//! the core-owned source PCM (ADR-9), conditions it exactly like preview playback
//! (mixdown → filter → resample), and runs the CPU-bound tool on the blocking pool
//! so the async workers stay free
//! model").
//!
//! The response carries the canonical **summary** beside the (shaped) result, so the
//! MCP handler, the CLI, and the analyzer tabs read the same contract; `shape` picks
//! raw arrays (`full`, what the tabs ask for), the compact form (`compact`), or no
//! result at all (`summary`).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::WebviewWindow;

use crate::audio::analysis::{
    self, AnalysisError, AnalysisPhase, AnalysisProgress, ResultSummary, Shape, SharedParams,
    ToolOptions,
};
use crate::audio::analyzers::AnalyzerId;
use crate::state::window_state;

/// One `run_analysis` request: the tool id, the analysis window (source seconds),
/// the shared params, any per-tool options, and how much of the result to return
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalysisRequest {
    pub tool: AnalyzerId,
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
    /// Spell a uniform `times` axis as `{ start, hop, length }` instead of an array.
    /// The analyzer tabs leave this false (they read the arrays); MCP/CLI callers can
    /// opt in to cut a full result's payload.
    #[serde(default)]
    #[ts(optional)]
    pub compact_axis: Option<bool>,
    /// The frontend's transient run token, echoed in every progress message and used by
    /// `cancel_analysis` to stop this run. `0` (the default) asks for no cancellation, so
    /// a caller that never cancels does not need an id (D-21).
    #[serde(default)]
    pub request_id: u64,
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
    /// The requested `frameRms` hop in samples, when the engine widened it to stay inside
    /// its frame cap (absent when the hop ran as asked, and for every other tool).
    /// Response-only: `result.hopSize` stays the effective hop.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hop_widened_from_samples: Option<usize>,
}

/// One analyzer's catalog detail (the GUI MCP `get_analyzer` path): option metadata
/// and summary keys, from the same Rust catalog the headless server uses.
#[tauri::command]
pub fn analyzer_detail(id: AnalyzerId) -> Result<Value, String> {
    crate::audio::analyzers::detail(id)
        .ok_or_else(|| crate::audio::analyzers::unknown_analyzer(id.as_ref()))
}

/// The analyzer catalog (the GUI MCP `list_analyzers` path), from the Rust catalog so
/// the bridge and the headless server agree on ids, options, and result families.
#[tauri::command]
pub fn analyzer_catalog() -> Vec<Value> {
    crate::audio::analyzers::list()
}

/// Run an analysis tool over `start..end` and return its summary + result.
///
/// The slice + condition + run work lives in [`analysis::run_window_with`], shared with
/// the headless MCP dispatcher; here it just runs on the blocking pool so the async
/// workers stay free.
///
/// Stage progress streams back on `on_progress` (D-21), and `cancel_analysis` with the
/// same `request_id` stops the run at its next cancellation check. The channel is
/// required because Tauri's `Channel` is a command argument, not a deserializable
/// value: a caller with no one to report to passes a throwaway one.
#[tauri::command]
pub async fn run_analysis(
    window: WebviewWindow,
    request: AnalysisRequest,
    on_progress: Channel<AnalysisProgress>,
) -> Result<AnalysisResponse, AnalysisError> {
    let AnalysisRequest {
        tool,
        start,
        end,
        params,
        options,
        shape,
        max_points,
        compact_axis,
        request_id,
    } = request;
    let state = window_state(&window);
    let cancel = state.analysis_cancels.begin(request_id);

    tauri::async_runtime::spawn_blocking(move || {
        // Forget the token however this task ends (Ok, Err, cancelled, or a panic).
        let _finished = FinishOnDrop {
            state: state.as_ref(),
            request_id,
        };
        let report = |phase: AnalysisPhase, fraction: f32| {
            // A closed webview drops the message: the run itself is unaffected.
            let _ = on_progress.send(AnalysisProgress {
                request_id,
                tool,
                phase,
                fraction,
            });
        };
        let result = analysis::run_window_with(
            &state, tool, start, end, &params, &options, &cancel, &report,
        )?;
        let summary = analysis::summarize(&result);
        let hop_widened_from_samples = analysis::widened_hop_from(&result, &options);
        let axis = if compact_axis.unwrap_or(false) {
            analysis::Axis::Compact
        } else {
            analysis::Axis::Array
        };
        let result = analysis::shape_result_with(&result, shape, max_points, axis);
        Ok(AnalysisResponse {
            summary,
            result,
            hop_widened_from_samples,
        })
    })
    .await
    .map_err(|err| AnalysisError::Analysis(err.to_string()))?
}

/// Ask the run with `request_id` to stop at its next cancellation check (D-21).
///
/// Synchronous — flipping a token needs no blocking pool — and a no-op for an unknown
/// or already finished id, so a late cancel is harmless.
#[tauri::command]
pub fn cancel_analysis(window: WebviewWindow, request_id: u64) {
    window_state(&window).analysis_cancels.cancel(request_id);
}

/// Removes the run's cancel token when the blocking task ends, so the registry cannot
/// leak an entry (success, error, cancellation, or a panic inside the tool).
struct FinishOnDrop<'a> {
    state: &'a crate::state::WindowState,
    request_id: u64,
}

impl Drop for FinishOnDrop<'_> {
    fn drop(&mut self) {
        self.state.analysis_cancels.finish(self.request_id);
    }
}
