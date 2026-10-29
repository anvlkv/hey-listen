//! Cross-project comparison (M25): run one tool over **two** projects and diff it.
//!
//! A comparison binds an owner project **A** and a reference project **B** to one
//! analyzer id. Both sides run through the existing [`analysis::run_window`], each from
//! its own [`WindowState`] (own PCM, own filter), so a comparison can never drift from
//! a normal tool run. Nothing is written to either project; B is read-only.
//!
//! The module is `tauri`-free, so the whole contract is unit-tested: [`align`] decides
//! comparability, [`diff`] computes the per-family delta, [`events`] pairs events, and
//! [`stats`] holds the numbers a caller reads without the arrays.
//! See `docs/comparison.md` and ADR-24.

pub mod align;
pub mod diff;
pub mod events;
pub mod stats;

pub use align::{Comparability, Span};
pub use diff::ComparisonDiff;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::audio::analysis::{
    self, AnalysisError, AnalysisResult, Axis, ResultSummary, Shape, SharedParams, ToolOptions,
};
use crate::state::WindowState;

/// One side's setup: the analysis window, the shared params, and the tool's options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareSetup {
    pub start: f64,
    pub end: f64,
    pub params: SharedParams,
    #[serde(default)]
    pub options: ToolOptions,
}

impl CompareSetup {
    /// The side's window as an ordered [`Span`].
    pub fn span(&self) -> Span {
        Span {
            start: self.start.min(self.end),
            end: self.start.max(self.end),
        }
    }
}

/// A project's source shape (what the picker and the view show).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceShape {
    pub sample_rate: u32,
    pub channels: u16,
    pub duration: f64,
}

/// One side of a comparison: what it was, how it ran, and what it produced.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonSide {
    /// The project's display name, when known.
    pub project: Option<String>,
    pub source: Option<SourceShape>,
    pub setup: CompareSetup,
    /// The tool's **effective** options (declared defaults overlaid with the overrides).
    pub options: Map<String, Value>,
    /// The canonical summary, computed from the full result.
    pub summary: ResultSummary,
    /// The full result (not serialized directly; the shaping layer emits it).
    #[serde(skip)]
    pub result: AnalysisResult,
}

/// Both sides plus what may be compared between them.
#[derive(Debug, Clone)]
pub struct Comparison {
    pub tool: String,
    pub a: ComparisonSide,
    pub b: ComparisonSide,
    pub comparability: Comparability,
    /// The delta, present only when the grids align (and, for time families, the
    /// windows overlap). The core computes it for **every** family.
    pub diff: Option<ComparisonDiff>,
}

/// One side's input: its project state plus the setup the caller wants applied.
pub struct SideInput<'a> {
    pub project: Option<String>,
    pub state: &'a WindowState,
    pub setup: CompareSetup,
}

/// Run `tool` over both projects and compare the results.
///
/// Both runs are sequential on the caller's blocking thread; a failure names the side.
pub fn compare(
    tool: &str,
    a: SideInput<'_>,
    b: SideInput<'_>,
) -> Result<Comparison, AnalysisError> {
    let a_source = source_shape(a.state)?;
    let b_source = source_shape(b.state)?;
    let filters_differ = filter_fingerprint(a.state) != filter_fingerprint(b.state);

    let a_result = run(tool, &a, "a")?;
    let b_result = run(tool, &b, "b")?;
    let a_rate = analysis_rate(a_source.sample_rate, &a.setup.params);
    let b_rate = analysis_rate(b_source.sample_rate, &b.setup.params);

    let comparability = {
        let side_a = align::Side {
            setup: &a.setup,
            result: &a_result,
            rate: a_rate,
        };
        let side_b = align::Side {
            setup: &b.setup,
            result: &b_result,
            rate: b_rate,
        };
        align::comparability(tool, &side_a, &side_b, filters_differ)
    };

    let diff = if comparability.aligned {
        let side_a = align::Side {
            setup: &a.setup,
            result: &a_result,
            rate: a_rate,
        };
        let side_b = align::Side {
            setup: &b.setup,
            result: &b_result,
            rate: b_rate,
        };
        Some(diff::diff(&side_a, &side_b, comparability.overlap))
    } else {
        None
    };

    Ok(Comparison {
        tool: tool.to_string(),
        a: side(a, a_result, a_source),
        b: side(b, b_result, b_source),
        comparability,
        diff,
    })
}

fn run(tool: &str, side: &SideInput<'_>, name: &str) -> Result<AnalysisResult, AnalysisError> {
    analysis::run_window(
        side.state,
        tool,
        side.setup.start,
        side.setup.end,
        &side.setup.params,
        &side.setup.options,
    )
    .map_err(|err| match err {
        AnalysisError::NoSource => {
            AnalysisError::Analysis(format!("side {name} has no audio source"))
        }
        other => AnalysisError::Analysis(format!("side {name}: {other}")),
    })
}

fn side(input: SideInput<'_>, result: AnalysisResult, source: SourceShape) -> ComparisonSide {
    ComparisonSide {
        project: input.project,
        source: Some(source),
        options: align::effective_options(result.tool_id(), &input.setup.options)
            .as_object()
            .cloned()
            .unwrap_or_default(),
        summary: analysis::summarize(&result),
        setup: input.setup,
        result,
    }
}

/// The effective analysis rate: the source rate, or `resampleTo` when set.
pub fn analysis_rate(source_rate: u32, params: &SharedParams) -> u32 {
    params
        .resample_to
        .map(|to| to.clamp(8_000, 384_000))
        .unwrap_or(source_rate.max(1))
}

/// A project's source shape, or [`AnalysisError::NoSource`].
pub fn source_shape(state: &WindowState) -> Result<SourceShape, AnalysisError> {
    let guard = state
        .audio
        .source
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let source = guard.as_ref().ok_or(AnalysisError::NoSource)?;
    let channels = source.channels.max(1);
    let frames = source.samples.len() / channels as usize;
    let sample_rate = source.sample_rate.max(1);
    Ok(SourceShape {
        sample_rate,
        channels,
        duration: frames as f64 / f64::from(sample_rate),
    })
}

/// A comparable fingerprint of the active filter (`None` = unfiltered).
fn filter_fingerprint(state: &WindowState) -> Option<Value> {
    let guard = state
        .audio
        .filter
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    guard
        .as_ref()
        .and_then(|spec| serde_json::to_value(spec).ok())
}

impl Comparison {
    /// The wire shape: both sides (shaped like `run_analysis`), the comparability, and
    /// the delta. `shape` controls how much of each **result** is returned; the delta's
    /// raw arrays follow `includeData` (i.e. `Shape::Full`).
    pub fn to_value(&self, shape: Shape, max_points: Option<usize>, axis: Axis) -> Value {
        let a = self.side_value(&self.a, shape, max_points, axis);
        let b = self.side_value(&self.b, shape, max_points, axis);
        let mut value = serde_json::json!({
            "tool": self.tool,
            "a": a,
            "b": b,
            "comparability": self.comparability,
        });
        if let Some(diff) = &self.diff {
            let mut diff_value = serde_json::to_value(diff).unwrap_or(Value::Null);
            if shape != Shape::Full {
                strip_delta_arrays(&mut diff_value);
            }
            value["diff"] = diff_value;
        }
        value
    }

    fn side_value(
        &self,
        side: &ComparisonSide,
        shape: Shape,
        max_points: Option<usize>,
        axis: Axis,
    ) -> Value {
        let mut value = serde_json::json!({
            "project": side.project,
            "source": side.source,
            "window": { "start": side.setup.start, "end": side.setup.end },
            "params": side.setup.params,
            "options": side.options,
            "summary": side.summary,
        });
        if let Some(result) = analysis::shape_result_with(&side.result, shape, max_points, axis) {
            value["result"] = result;
        }
        value
    }
}

/// Drop the delta's raw numeric arrays (the stats remain), for the compact and summary
/// modes. Event/note lists are never thinned, so they stay.
fn strip_delta_arrays(value: &mut Value) {
    const ARRAYS: [&str; 6] = ["times", "values", "a", "b", "freqs", "rateHz"];
    let Some(object) = value.as_object_mut() else {
        return;
    };

    for key in ARRAYS {
        if object.contains_key(key) {
            object.insert(key.to_string(), Value::Array(Vec::new()));
        }
    }
    // A nested envelope/line delta carries its own stats; clear only its arrays.
    for key in ["envelope", "am", "fm"] {
        if let Some(nested) = object.get_mut(key) {
            strip_delta_arrays(nested);
        }
    }
}

#[cfg(test)]
mod tests;
