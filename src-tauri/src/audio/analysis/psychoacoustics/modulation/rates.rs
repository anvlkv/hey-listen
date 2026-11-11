//! The bounded modulation-rate axis and the per-frame band × rate cells (M36), split out
//! of `modulation.rs` for the source-size budget.
//!
//! [`grid`] is a **geometric** [`MIN_RATE_HZ`]–[`MAX_RATE_HZ`] axis with [`RATE_COUNT`]
//! points: the low end is about the slowest fluctuation the model targets and the high
//! end the fastest roughness, and log spacing spends the points around the two
//! perceptual weights instead of the empty top of the range. Each weight falls within a
//! few percent of a grid point, so the reference tones peak on their own point (the
//! 4 Hz / 70 Hz peak assertions in `tests` pin that).
//!
//! [`RateCells::collect`] measures one band's retained envelope window with a
//! single-bin DFT per rate:
//!
//! `depth(r) = 2 · |Σ_n (env[n] − mean) · e^{−i 2π r n / envelope_rate}| / (mean · N)`
//!
//! clamped to [`MAX_DEPTH`]. Subtracting the mean removes the window's DC term, so the
//! raw transform's DC leakage cannot invent a low-rate depth for a flat carrier. The
//! estimate is a single-bin DFT at an arbitrary (non-bin) rate, so off-rate cells are
//! approximate and a steady envelope can still show the filterbank's own ripple away from
//! the tool's measured rate; at the measured rate a steady carrier reads ~0 and a 100 %
//! amplitude modulation reads a depth of about 1.
//!
//! The cost is bounded by the window the scalar already retains: at most
//! `RATE_COUNT × N` multiply-adds per gated band per frame, where `N` is that same
//! `window_secs` envelope span. It does not widen the decimation.

use std::f64::consts::TAU;

/// The rate axis' lowest rate (Hz).
const MIN_RATE_HZ: f64 = 1.0;
/// The rate axis' highest rate (Hz): above the roughness region, below the envelope
/// smoother's cutoff.
const MAX_RATE_HZ: f64 = 100.0;
/// Points on the rate axis.
const RATE_COUNT: usize = 24;
/// The largest depth a cell may report: a band-pass transient can overshoot 100 % AM,
/// but an unbounded value would make the heatmap's colour scale meaningless.
const MAX_DEPTH: f64 = 4.0;

/// The geometric rate axis: [`RATE_COUNT`] points from [`MIN_RATE_HZ`] to
/// [`MAX_RATE_HZ`].
pub(super) fn grid() -> Vec<f32> {
    let ratio = (MAX_RATE_HZ / MIN_RATE_HZ).powf(1.0 / (RATE_COUNT - 1) as f64);
    (0..RATE_COUNT)
        .map(|index| (MIN_RATE_HZ * ratio.powi(index as i32)) as f32)
        .collect()
}

/// One frame's `bands × rates` cells, the axis they measure and the envelope rate they
/// are sampled at.
pub(super) struct RateCells<'a> {
    hz: &'a [f32],
    envelope_rate: f64,
    /// Frame-local, `bands × rates`; empty when the tool does not collect rates.
    cells: &'a mut [f32],
}

impl<'a> RateCells<'a> {
    pub(super) fn new(hz: &'a [f32], envelope_rate: f64, cells: &'a mut [f32]) -> Self {
        Self {
            hz,
            envelope_rate,
            cells,
        }
    }

    /// Fill `band`'s rate row with its fractional modulation depths. A band below the
    /// level gate (or one with no measurable envelope mean) keeps its zero row.
    pub(super) fn collect(&mut self, band: usize, envelope: &[f32], mean: f64) {
        let rates = self.hz.len();
        if rates == 0 || mean <= 1e-9 {
            return;
        }
        let Some(cells) = self.cells.get_mut(band * rates..(band + 1) * rates) else {
            return;
        };
        let scale = 2.0 / (mean * envelope.len() as f64);
        for (cell, &rate) in cells.iter_mut().zip(self.hz) {
            let omega = TAU * f64::from(rate) / self.envelope_rate;
            // A rotating unit phasor `e^{−iωn}`: one sin/cos per rate, then multiply-adds.
            let step = (omega.cos(), -omega.sin());
            let (mut cos, mut sin) = (1.0, 0.0);
            let (mut re, mut im) = (0.0, 0.0);
            for &value in envelope {
                let centred = f64::from(value) - mean;
                re += centred * cos;
                im += centred * sin;
                (cos, sin) = (cos * step.0 - sin * step.1, cos * step.1 + sin * step.0);
            }
            let depth = scale * re.hypot(im);
            *cell = if depth.is_finite() {
                depth.min(MAX_DEPTH) as f32
            } else {
                0.0
            };
        }
    }
}
