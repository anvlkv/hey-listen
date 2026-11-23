//! Cross-project comparison (M25): run one tool over **two** projects and diff it.
//!
//! A comparison binds an owner project **A** and a reference project **B** to one
//! analyzer id. The owner's grid always wins: A runs from its own setup, and B is
//! re-analysed on **A's** shared params and tool options (keeping only its own channel,
//! window and filter), so a live comparison always produces a delta. Both sides run
//! through the existing [`analysis::run_window`], so a comparison can never drift from
//! a normal tool run. Nothing is written to either project; B is read-only.
//!
//! The module is `tauri`-free, so the whole contract is unit-tested: [`align`] decides
//! comparability, [`diff`] computes the per-family delta, [`events`] pairs events, and
//! [`stats`] holds the numbers a caller reads without the arrays.
//! See and ADR-24.

pub mod align;
pub mod diff;
pub mod events;
pub mod saved;
pub mod stats;
mod wire;

pub use align::{Comparability, Span};
pub use diff::ComparisonDiff;
pub use saved::{SavedComparison, SavedComparisonInfo};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::audio::analysis::{
    self, AnalysisError, AnalysisResult, ResultSummary, SharedParams, ToolOptions,
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
    /// The delta. A live comparison always has one (B ran on A's grid) unless a
    /// time-axis family's shifted windows do not meet; a saved snapshot also needs its
    /// grid to match (see [`assemble`]).
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
/// A runs from its own setup; B runs on **A's grid** (its params and options, keeping
/// its own window, channel and filter), so a numeric delta always exists (M23 Phase
/// 3). Both runs are sequential on the caller's blocking thread; a failure names the
/// side. `b_offset` (δ) shifts the reference on the relative axis; matching and the
/// delta cover the common span (M25.B).
pub fn compare(
    tool: AnalyzerId,
    a: SideInput<'_>,
    b: SideInput<'_>,
    b_offset: f64,
) -> Result<Comparison, AnalysisError> {
    let a_source = source_shape(a.state)?;
    let b_source = source_shape(b.state)?;
    let filters_differ = filter_fingerprint(a.state) != filter_fingerprint(b.state);
    let b_setup = align::owner_grid_setup(
        &a.setup,
        &b.setup,
        a_source.sample_rate,
        b_source.sample_rate,
    );

    let a_result = run(tool, a.state, &a.setup, "a")?;
    let b_result = run(tool, b.state, &b_setup, "b")?;

    Ok(assemble(
        tool,
        PreparedSide::new(a.project.clone(), a_source, a.setup.clone(), a_result),
        PreparedSide::new(b.project.clone(), b_source, b_setup, b_result),
        b_offset,
        filters_differ,
        false,
    ))
}

/// Compare the owner against a **saved reference snapshot** (M25.C): only A is
/// analysed; B's result comes from the snapshot. A snapshot was produced by an earlier
/// run, so its grid can differ from A's — that is reported, and it keeps the grid gate
/// until the snapshot carries fragment audio to re-grid (M23 Phase 3 slice 2).
pub fn compare_saved(
    tool: AnalyzerId,
    a: SideInput<'_>,
    saved: &SavedComparison,
    b_offset: f64,
) -> Result<Comparison, AnalysisError> {
    let a_source = source_shape(a.state)?;
    let filters_differ = filter_fingerprint(a.state) != saved.filter_fingerprint;
    let a_result = run(tool, a.state, &a.setup, "a")?;

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
        true,
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
///
/// `require_grid` keeps the grid gate: a live comparison is always diffed because B ran
/// on A's grid, while a saved snapshot must still match (see [`compare_saved`]).
fn assemble(
    tool: AnalyzerId,
    a: PreparedSide,
    b: PreparedSide,
    b_offset: f64,
    filters_differ: bool,
    require_grid: bool,
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
        let comparable = (!require_grid || comparability.aligned)
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
    state: &WindowState,
    setup: &CompareSetup,
    name: &str,
) -> Result<AnalysisResult, AnalysisError> {
    analysis::run_window(
        state,
        tool,
        setup.start,
        setup.end,
        &setup.params,
        &setup.options,
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
pub fn filter_fingerprint(state: &WindowState) -> Option<String> {
    let guard = state
        .audio
        .filter
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let spec = guard.as_ref()?;
    serde_json::to_string(spec).ok()
}

#[cfg(test)]
mod tests;
