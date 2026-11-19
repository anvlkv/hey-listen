//! Progress reporting for a running analysis (D-21).
//!
//! The engine reports each [`AnalysisPhase`]; the command layer wraps a report into an
//! [`AnalysisProgress`] carrying the request it belongs to and streams it to the
//! frontend over a `Channel`. Nothing here is stored in the project.

use serde::{Deserialize, Serialize};

use crate::audio::analyzers::AnalyzerId;

/// The stage a run has reached, in the order [`super::run_window_with`] reports them.
///
/// A typed id: the wire spelling is camelCase, so the frontend imports the generated
/// union instead of re-declaring the names.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::Display,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::VariantNames,
    ts_rs::TS,
)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
#[ts(export, rename_all = "camelCase")]
pub enum AnalysisPhase {
    /// Copying the windowed region out of the source.
    Slicing,
    /// Mixdown → filter → resample, the same path preview plays.
    Conditioning,
    /// The tool itself (the long part for the heavy analyzers).
    Analysing,
    /// Re-basing the result onto source seconds.
    Shaping,
    /// The result is ready.
    Done,
}

/// One progress message on the `run_analysis` channel.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalysisProgress {
    /// The frontend's transient request token (`0` when it asked for no cancellation).
    pub request_id: u64,
    pub tool: AnalyzerId,
    pub phase: AnalysisPhase,
    /// How far the run is, 0…1. Non-decreasing within one run.
    pub fraction: f32,
}
