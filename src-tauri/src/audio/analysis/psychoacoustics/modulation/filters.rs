//! The IIR sections and the per-band streaming envelope pipeline behind `roughness`
//! and `fluctuationStrength`, split out of `modulation.rs` for the source-size budget.

use std::collections::VecDeque;

use super::super::scales::bark;
use super::{ANTI_ALIAS_FRACTION, BAND_Q_MAX, BAND_Q_MIN, ENVELOPE_LP_HZ, RIPPLE_GUARD};

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

    /// A second-order (Butterworth, `Q = 1 / √2`) low-pass at `hz`: the envelope's
    /// anti-alias stage, applied before the decimation.
    pub(super) fn low_pass(hz: f64, rate: f64) -> Self {
        let w0 = std::f64::consts::TAU * (hz / rate).clamp(1e-6, 0.45);
        let (sin, cos) = (w0.sin(), w0.cos());
        let alpha = sin / std::f64::consts::SQRT_2;
        let a0 = 1.0 + alpha;
        let half = (1.0 - cos) / 2.0 / a0;
        Self {
            b0: half,
            b1: 2.0 * half,
            b2: half,
            a1: -2.0 * cos / a0,
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

/// The filter geometry every band of one pass shares.
pub(super) struct Config {
    /// Source sample rate.
    pub(super) rate: f64,
    /// Envelope sample rate after the decimation.
    pub(super) envelope_rate: f64,
    /// Source samples per envelope sample.
    pub(super) decim: usize,
    /// Envelope samples each rolling buffer keeps.
    pub(super) capacity: usize,
    /// Envelope samples the modulation filter is warmed on.
    pub(super) settle: usize,
    /// The tool's modulation filter: `(target rate, quality factor)`.
    pub(super) modulation: (f64, f64),
}

/// The envelope smoother's cutoff: at most [`ENVELOPE_LP_HZ`], at most
/// [`RIPPLE_GUARD`] × the band's own centre, and always below the decimation's
/// anti-alias corner. The band tie is what keeps a **steady** carrier out of the
/// modulation filter: full-wave rectification doubles the carrier (35 Hz → 70 Hz,
/// exactly the roughness rate), and a cutoff a quarter of the centre leaves that
/// ripple at least two octaves above the smoother.
fn envelope_cutoff(centre: f64, envelope_rate: f64) -> f64 {
    (centre * RIPPLE_GUARD)
        .clamp(1.0, ENVELOPE_LP_HZ)
        .min(ANTI_ALIAS_FRACTION * envelope_rate)
}

/// Append `value`, dropping the oldest sample once the buffer is full.
fn store(queue: &mut VecDeque<f32>, capacity: usize, value: f32) {
    if queue.len() == capacity {
        queue.pop_front();
    }
    queue.push_back(value);
}

/// Advance a decimation phase: `true` on every `decim`-th call, starting with the first.
fn tick(phase: &mut usize, decim: usize) -> bool {
    let produced = *phase == 0;
    *phase = (*phase + 1) % decim;
    produced
}

/// One critical band's streaming envelope → modulation filter.
pub(super) struct Channel {
    /// The band's Bark position.
    pub(super) z: f64,
    pass: Biquad,
    smooth_a: OnePole,
    smooth_b: OnePole,
    anti_alias: Biquad,
    modulation_a: Biquad,
    modulation_b: Biquad,
    envelope: VecDeque<f32>,
    modulated: VecDeque<f32>,
    /// The envelope's first [`Config::settle`] samples, kept for the warm-up.
    warmup: Vec<f32>,
    capacity: usize,
    settle: usize,
    decim: usize,
    phase: usize,
    primed: bool,
}

impl Channel {
    pub(super) fn new(centre: f64, width: f64, config: &Config) -> Self {
        let q = (centre / width).clamp(BAND_Q_MIN, BAND_Q_MAX);
        let cutoff = envelope_cutoff(centre, config.envelope_rate);
        let (target_hz, modulation_q) = config.modulation;
        Self {
            z: f64::from(bark(centre as f32)),
            pass: Biquad::band_pass(centre, q, config.rate),
            smooth_a: OnePole::low_pass(cutoff, config.rate),
            smooth_b: OnePole::low_pass(cutoff, config.rate),
            anti_alias: Biquad::low_pass(ANTI_ALIAS_FRACTION * config.envelope_rate, config.rate),
            modulation_a: Biquad::band_pass(target_hz, modulation_q, config.envelope_rate),
            modulation_b: Biquad::band_pass(target_hz, modulation_q, config.envelope_rate),
            envelope: VecDeque::with_capacity(config.capacity),
            modulated: VecDeque::with_capacity(config.capacity),
            warmup: Vec::with_capacity(config.settle),
            capacity: config.capacity,
            settle: config.settle,
            decim: config.decim,
            phase: 0,
            primed: false,
        }
    }

    /// Feed one source sample; returns `true` when a new envelope sample was produced.
    pub(super) fn push(&mut self, sample: f64) -> bool {
        let rectified = self.pass.process(sample).abs();
        let smoothed = self.smooth_b.process(self.smooth_a.process(rectified));
        let limited = self.anti_alias.process(smoothed);
        if !tick(&mut self.phase, self.decim) {
            return false;
        }
        store(&mut self.envelope, self.capacity, limited as f32);
        if !self.primed {
            self.warmup.push(limited as f32);
            if self.warmup.len() >= self.settle {
                self.prime();
            }
            return true;
        }
        let modulated = self.moderate(limited);
        store(&mut self.modulated, self.capacity, modulated as f32);
        true
    }

    /// The number of envelope samples buffered (at most the configured capacity).
    pub(super) fn available(&self) -> usize {
        self.envelope.len()
    }

    /// Whether the modulation filter has been warmed.
    pub(super) fn primed(&self) -> bool {
        self.primed
    }

    /// Warm the modulation filter on the envelope's first `settle` samples (cycled
    /// when the selection is shorter) and replay them for the measured outputs — the
    /// same warm-up the whole-window pipeline applied before filtering.
    pub(super) fn prime(&mut self) {
        if self.primed {
            return;
        }
        self.primed = true;
        let warmup = std::mem::take(&mut self.warmup);
        if warmup.is_empty() {
            return;
        }
        let period = warmup.len();
        for index in 0..self.settle {
            self.moderate(f64::from(warmup[index % period]));
        }
        for value in warmup {
            let modulated = self.moderate(f64::from(value));
            store(&mut self.modulated, self.capacity, modulated as f32);
        }
    }

    /// The most recent `count` envelope and modulation samples, oldest first.
    /// `count` must not exceed [`Channel::available`]; the two buffers always hold the
    /// same number of samples.
    pub(super) fn window(&mut self, count: usize) -> (&[f32], &[f32]) {
        let envelope = self.envelope.make_contiguous();
        let modulated = self.modulated.make_contiguous();
        let start = envelope.len() - count;
        (&envelope[start..], &modulated[modulated.len() - count..])
    }

    fn moderate(&mut self, value: f64) -> f64 {
        self.modulation_b.process(self.modulation_a.process(value))
    }
}

/// The broadband level of the decimated input over the same rolling window: the
/// reference the band gate compares each band's envelope against, so a carrier outside
/// the selected range cannot reach the modulation filter through the band-pass skirts.
pub(super) struct Level {
    squares: VecDeque<f32>,
    capacity: usize,
    sum: f64,
    count: usize,
    decim: usize,
    phase: usize,
}

impl Level {
    pub(super) fn new(window: usize, decim: usize) -> Self {
        Self {
            squares: VecDeque::with_capacity(window),
            capacity: window,
            sum: 0.0,
            count: 0,
            decim,
            phase: 0,
        }
    }

    /// Accumulate one source sample; returns `true` in lock step with
    /// [`Channel::push`].
    pub(super) fn push(&mut self, sample: f64) -> bool {
        self.sum += sample * sample;
        self.count += 1;
        if !tick(&mut self.phase, self.decim) {
            return false;
        }
        let mean_square = self.sum / self.count as f64;
        self.sum = 0.0;
        self.count = 0;
        store(&mut self.squares, self.capacity, mean_square as f32);
        true
    }

    /// The RMS over the most recent `count` samples (`0` before any).
    pub(super) fn rms(&self, count: usize) -> f64 {
        let count = count.min(self.squares.len());
        if count == 0 {
            return 0.0;
        }
        let sum: f64 = self
            .squares
            .iter()
            .rev()
            .take(count)
            .map(|&value| f64::from(value))
            .sum();
        (sum / count as f64).sqrt()
    }
}
