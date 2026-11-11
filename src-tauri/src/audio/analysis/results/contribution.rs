//! The per-frame, per-band **contribution** grid behind a perceptual tool's scalar
//! series (M36 drill-down).
//!
//! Several psychoacoustic tools report one number per frame that is a weighted sum over
//! critical bands (`sharpness`, `roughness`, `fluctuationStrength`) or over spectral
//! lines (`tonality`). The scalar answers *how much*; this grid answers *which bands
//! produced it*, so a drill-down chart can show the decomposition instead of only the
//! total. Each tool documents what a cell means and how the columns relate to its
//! scalar, and the grid repeats that in the payload itself (`label` and `unit`) so a
//! consumer does not have to infer it from the tool id.

use serde::{Deserialize, Serialize};

/// A frame × band matrix that decomposes a tool's scalar series.
///
/// `values` is **frame-major** (`frames * bins`), like [`super::MatrixResult`], and
/// `times` / `bands` share its two axes. A frame the tool could not measure is a row of
/// zeros, so the grid stays rectangular and aligned with the scalar series' gaps.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Contribution {
    pub frames: usize,
    pub bins: usize,
    /// Frame times in **source seconds** (rebased by `run_window`).
    pub times: Vec<f32>,
    /// Band/rate centres for the columns (Hz or a labelled axis).
    pub bands: Vec<f32>,
    /// Frame-major `frames * bins` contributions.
    pub values: Vec<f32>,
    /// What a value is, e.g. "sharpness weight" (display copy, not an id).
    pub label: String,
    /// The values' unit, when they have one (`"sone/Cam"`, `"asper"`, `"dB"`, …).
    #[serde(default)]
    pub unit: Option<String>,
}

#[cfg(test)]
impl Contribution {
    /// Assert the grid's axes agree and that every cell and band centre is finite.
    ///
    /// Shared by the per-tool tests, so the dimensional invariant is stated once rather
    /// than restated in each tool's test module.
    pub(crate) fn assert_consistent(&self) {
        assert_eq!(
            self.times.len(),
            self.frames,
            "a contribution's time axis must have one entry per frame"
        );
        assert_eq!(
            self.bands.len(),
            self.bins,
            "a contribution's band axis must have one entry per column"
        );
        assert_eq!(
            self.values.len(),
            self.frames * self.bins,
            "a contribution must hold `frames * bins` values"
        );
        assert!(
            self.values.iter().all(|value| value.is_finite()),
            "a contribution value is not finite"
        );
        assert!(
            self.bands.iter().all(|band| band.is_finite()),
            "a contribution band centre is not finite"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::Contribution;

    #[test]
    fn a_well_formed_contribution_passes_its_own_invariant() {
        let contribution = Contribution {
            frames: 2,
            bins: 2,
            times: vec![0.0, 0.5],
            bands: vec![250.0, 1_000.0],
            values: vec![0.0, 1.0, 2.0, 3.0],
            label: "sharpness weight".to_string(),
            unit: Some("sone/Cam".to_string()),
        };
        contribution.assert_consistent();
    }
}
