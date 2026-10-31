//! The window function id (split out of [`super`] to keep the type module small).

use oxiaudio::dsp::spectral::WindowFn;
use serde::{Deserialize, Serialize};

/// A window function for frame-based tools (`docs/analysis-tools.md`).
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    Deserialize,
    Serialize,
    strum::EnumString,
    strum::Display,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::EnumIter,
    strum::VariantNames,
    ts_rs::TS,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
#[ts(export)]
pub enum WindowKind {
    #[default]
    Hann,
    Hamming,
    Blackman,
    Rectangular,
}

impl WindowKind {
    /// The `oxiaudio` window function this id names.
    pub(in crate::audio::analysis) fn to_window_fn(self) -> WindowFn {
        match self {
            WindowKind::Hann => WindowFn::Hann,
            WindowKind::Hamming => WindowFn::Hamming,
            WindowKind::Blackman => WindowFn::Blackman,
            WindowKind::Rectangular => WindowFn::Rectangular,
        }
    }
}
