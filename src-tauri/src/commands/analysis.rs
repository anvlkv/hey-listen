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

    // Slice the windowed region (a copy) and read the active filter under the lock,
    // then release it before the CPU-bound work runs (the guard is not `Send`).
    let (region, channels, sample_rate, filter) = {
        let state = window_state(&window);
        let guard = state
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let source = guard.as_ref().ok_or(AnalysisError::NoSource)?;

        let channels = source.channels.max(1) as usize;
        let frames = source.samples.len() / channels;
        let sample_rate = source.sample_rate.max(1);

        let first = ((start.max(0.0) * f64::from(sample_rate)).floor() as usize).min(frames);
        let last = ((end.max(0.0) * f64::from(sample_rate)).ceil() as usize)
            .min(frames)
            .max(first);
        if last <= first {
            return Err(AnalysisError::EmptyWindow);
        }
        let region = source.samples[first * channels..last * channels].to_vec();

        let filter = state
            .audio
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone();

        (region, source.channels.max(1), sample_rate, filter)
    };

    tauri::async_runtime::spawn_blocking(move || {
        let (mono, rate) = analysis::condition(
            &region,
            channels,
            sample_rate,
            filter.as_ref(),
            params.channel,
            params.resample_to,
        )?;
        analysis::run(&tool, &mono, rate, &params, &options)
    })
    .await
    .map_err(|err| AnalysisError::Analysis(err.to_string()))?
}
