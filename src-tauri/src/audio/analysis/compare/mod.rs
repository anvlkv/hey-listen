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
pub mod saved;
pub mod stats;

pub use align::{Comparability, Span};
pub use diff::ComparisonDiff;
pub use saved::{SavedComparison, SavedComparisonInfo};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::audio::analysis::{
    self, AnalysisError, AnalysisResult, Axis, ResultSummary, Shape, SharedParams, ToolOptions,
};
use crate::audio::analyzers::AnalyzerId;
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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
    pub tool: AnalyzerId,
    pub a: ComparisonSide,
    pub b: ComparisonSide,
    pub comparability: Comparability,
    /// The delta, present only when the grids align (and, for time families, the
    /// shifted windows meet). The core computes it for **every** family.
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
/// `b_offset` (δ) shifts the reference on the relative axis; matching and the delta
/// cover the common span (M25.B).
pub fn compare(
    tool: AnalyzerId,
    a: SideInput<'_>,
    b: SideInput<'_>,
    b_offset: f64,
) -> Result<Comparison, AnalysisError> {
    let a_source = source_shape(a.state)?;
    let b_source = source_shape(b.state)?;
    let filters_differ = filter_fingerprint(a.state) != filter_fingerprint(b.state);

    let a_result = run(tool, &a, "a")?;
    let b_result = run(tool, &b, "b")?;

    Ok(assemble(
        tool,
        PreparedSide::new(a.project.clone(), a_source, a.setup.clone(), a_result),
        PreparedSide::new(b.project.clone(), b_source, b.setup.clone(), b_result),
        b_offset,
        filters_differ,
    ))
}

/// Compare the owner against a **saved reference snapshot** (M25.C): only A is
/// analysed; B's result comes from the snapshot. The grid comparability still runs, so
/// a snapshot from a different setup than A is reported, never silently diffed.
pub fn compare_saved(
    tool: AnalyzerId,
    a: SideInput<'_>,
    saved: &SavedComparison,
    b_offset: f64,
) -> Result<Comparison, AnalysisError> {
    let a_source = source_shape(a.state)?;
    let filters_differ = filter_fingerprint(a.state) != saved.filter_fingerprint;
    let a_result = run(tool, &a, "a")?;

    Ok(assemble(
        tool,
        PreparedSide::new(a.project.clone(), a_source, a.setup.clone(), a_result),
        PreparedSide::new(
            Some(saved.reference_name.clone()),
            saved.source,
            saved.setup(),
            saved.analysis_result(),
        ),
        b_offset,
        filters_differ,
    ))
}

/// One side ready to be compared: identity, shape, setup and the result.
struct PreparedSide {
    project: Option<String>,
    source: SourceShape,
    setup: CompareSetup,
    result: AnalysisResult,
}

impl PreparedSide {
    fn new(
        project: Option<String>,
        source: SourceShape,
        setup: CompareSetup,
        result: AnalysisResult,
    ) -> Self {
        Self {
            project,
            source,
            setup,
            result,
        }
    }

    fn into_side(self, tool: AnalyzerId) -> ComparisonSide {
        ComparisonSide {
            project: self.project,
            source: Some(self.source),
            options: align::effective_options(tool, &self.setup.options)
                .as_object()
                .cloned()
                .unwrap_or_default(),
            summary: analysis::summarize(&self.result),
            setup: self.setup,
            result: self.result,
        }
    }
}

/// Build the comparison from two prepared sides (live or saved).
fn assemble(
    tool: AnalyzerId,
    a: PreparedSide,
    b: PreparedSide,
    b_offset: f64,
    filters_differ: bool,
) -> Comparison {
    let a_rate = analysis_rate(a.source.sample_rate, &a.setup.params);
    let b_rate = analysis_rate(b.source.sample_rate, &b.setup.params);
    let alignment = align::Alignment::new(a.setup.span().len(), b.setup.span().len(), b_offset);

    let (comparability, diff) = {
        let side_a = align::Side {
            setup: &a.setup,
            result: &a.result,
            rate: a_rate,
        };
        let side_b = align::Side {
            setup: &b.setup,
            result: &b.result,
            rate: b_rate,
        };
        let comparability = align::comparability(tool, &side_a, &side_b, filters_differ, alignment);
        // A time-axis family needs the shifted windows to meet; spectrum, modulation and
        // the scalar readouts diff without one.
        let comparable = comparability.aligned
            && (!align::needs_common_span(tool) || alignment.common.is_some());
        let diff = comparable.then(|| diff::diff(&side_a, &side_b, b_offset, alignment.common));
        (comparability, diff)
    };

    Comparison {
        tool,
        a: a.into_side(tool),
        b: b.into_side(tool),
        comparability,
        diff,
    }
}

fn run(
    tool: AnalyzerId,
    side: &SideInput<'_>,
    name: &str,
) -> Result<AnalysisResult, AnalysisError> {
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

/// A comparable fingerprint of the active filter (`None` = unfiltered), as canonical
/// JSON so a live side and a saved snapshot compare with `==` (M25.C).
pub(crate) fn filter_fingerprint(state: &WindowState) -> Option<String> {
    let guard = state
        .audio
        .filter
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let spec = guard.as_ref()?;
    serde_json::to_string(spec).ok()
}

impl Comparison {
    /// The wire shape: both sides (shaped like `run_analysis`), the comparability, and
    /// the delta. `shape` controls how much of each **result** is returned; the delta's
    /// raw arrays follow `includeData` (i.e. `Shape::Full`), are thinned by `max_points`
    /// and share `axis` with the side results (MCP/CLI parity).
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
            value["diff"] = delta_value(diff, shape, max_points, axis);
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

/// Shape the delta for the wire: full (optionally thinned and compacted), or stats +
/// summary with the raw arrays cleared.
fn delta_value(
    diff: &ComparisonDiff,
    shape: Shape,
    max_points: Option<usize>,
    axis: Axis,
) -> Value {
    if shape == Shape::Full {
        let mut full = diff.clone();
        if let Some(points) = max_points {
            full.thin(points);
        }
        let value = serde_json::to_value(&full).unwrap_or(Value::Null);
        match axis {
            Axis::Array => value,
            Axis::Compact => super::shape::compact_time_axes(value),
        }
    } else {
        let mut value = serde_json::to_value(diff).unwrap_or(Value::Null);
        strip_delta_arrays(&mut value);
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
