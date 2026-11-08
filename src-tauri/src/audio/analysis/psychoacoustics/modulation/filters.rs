//! The two IIR sections the modulation pipeline needs, split out of `modulation.rs`
//! for the source-size budget.

/// A second-order IIR section (transposed direct form II).
#[derive(Clone, Copy, Default)]
pub(super) struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    /// A constant-0-dB-peak-gain band-pass at `hz` with quality factor `q`.
    pub(super) fn band_pass(hz: f64, q: f64, rate: f64) -> Self {
        let w0 = std::f64::consts::TAU * (hz / rate).clamp(1e-6, 0.45);
        let alpha = w0.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        Self {
            b0: alpha / a0,
            b1: 0.0,
            b2: -alpha / a0,
            a1: -2.0 * w0.cos() / a0,
            a2: (1.0 - alpha) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    pub(super) fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

/// A one-pole low-pass, the envelope smoother.
#[derive(Clone, Copy)]
pub(super) struct OnePole {
    alpha: f64,
    y: f64,
}

impl OnePole {
    pub(super) fn low_pass(hz: f64, rate: f64) -> Self {
        Self {
            alpha: 1.0 - (-std::f64::consts::TAU * hz / rate).exp(),
            y: 0.0,
        }
    }

    pub(super) fn process(&mut self, x: f64) -> f64 {
        self.y += self.alpha * (x - self.y);
        self.y
    }
}
