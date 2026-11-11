//! The per-frame **band × modulation-rate** matrix behind `roughness` and
//! `fluctuationStrength` (M36).
//!
//! The scalar series answers *how rough* (or *how fluctuating*) a frame is, and the
//! [`Contribution`](super::Contribution) grid answers *which critical bands* produced
//! that total at the tool's own target rate. This grid is the third axis: each band's
//! fractional modulation depth at **every** rate on a bounded grid, so a drill-down can
//! show the band × rate region instead of only the one rate the tool weights.
//!
//! `values` is frame-major, then band-major, then rate: `frames * bands * rates`
//! entries. A cell is the band's fractional modulation depth at that rate (`0` =
//! steady) — the raw envelope ratio, not the tool's weighted, calibrated unit. A frame
//! with nothing to measure is a row of zeros, so the grid stays rectangular and aligned
//! with the scalar series' gaps.

use serde::{Deserialize, Serialize};

/// A frame × band × rate matrix of fractional modulation depths (M36).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RateContribution {
    pub frames: usize,
    pub bands: usize,
    pub rates: usize,
    /// Band-centre frequencies (Hz), one per band.
    pub band_hz: Vec<f32>,
    /// Modulation rates (Hz), one per rate column.
    pub rate_hz: Vec<f32>,
    /// Frame-major, then band-major, then rate: `frames * bands * rates` values.
    /// Each is the band's fractional modulation depth at that rate (0 = steady).
    pub values: Vec<f32>,
}

#[cfg(test)]
impl RateContribution {
    /// Assert the grid's three axes agree and that every cell and axis value is finite
    /// and non-negative.
    ///
    /// Shared by the tool and stored-form tests, so the dimensional invariant is stated
    /// once rather than restated in each tool's test module.
    pub(crate) fn assert_consistent(&self) {
        assert_eq!(
            self.band_hz.len(),
            self.bands,
            "a rate matrix's band axis must have one entry per band"
        );
        assert_eq!(
            self.rate_hz.len(),
            self.rates,
            "a rate matrix's rate axis must have one entry per rate column"
        );
        assert_eq!(
            self.values.len(),
            self.frames * self.bands * self.rates,
            "a rate matrix must hold `frames * bands * rates` values"
        );
        assert!(
            self.band_hz.iter().all(|hz| hz.is_finite() && *hz >= 0.0),
            "a rate matrix band centre is not finite and non-negative"
        );
        assert!(
            self.rate_hz.iter().all(|hz| hz.is_finite() && *hz > 0.0),
            "a rate matrix rate is not finite and positive"
        );
        assert!(
            self.values
                .iter()
                .all(|value| value.is_finite() && *value >= 0.0),
            "a rate matrix cell is not a finite, non-negative depth"
        );
    }
}
