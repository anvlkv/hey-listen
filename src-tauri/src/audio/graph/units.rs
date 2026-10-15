//! Custom [`AudioUnit`] implementations the engine needs but fundsp does not ship:
//! the `mix` summer, the math units, and the compressor/gate dynamics processor.
//!
//! These are constructed only by the node palette in [`super::compile`], so they are
//! `pub(super)`.

use fundsp::prelude64::*;

/// Sums `inputs` mono channels into one (used by `mix`).
#[derive(Clone)]
pub(super) struct SumUnit {
    pub(super) inputs: usize,
}

impl AudioUnit for SumUnit {
    fn inputs(&self) -> usize {
        self.inputs
    }

    fn outputs(&self) -> usize {
        1
    }

    fn tick(&mut self, input: &[f32], output: &mut [f32]) {
        let mut sum = 0.0;
        for &sample in input {
            sum += sample;
        }
        output[0] = sum;
    }

    fn process(&mut self, size: usize, input: &BufferRef, output: &mut BufferMut) {
        for i in 0..size {
            let mut sum = 0.0;
            for channel in 0..self.inputs {
                sum += input.at_f32(channel, i);
            }
            output.set_f32(0, i, sum);
        }
    }

    fn route(&mut self, _input: &SignalFrame, _frequency: f64) -> SignalFrame {
        SignalFrame::new(self.outputs())
    }

    fn get_id(&self) -> u64 {
        0x6865_796c_6973_656e
    }

    fn footprint(&self) -> usize {
        core::mem::size_of::<Self>()
    }
}

pub(super) fn finite(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

/// A binary signal operator (2 in / 1 out) used by the **Math** nodes.
#[derive(Clone, Copy)]
pub(super) enum MathOp {
    Add,
    Subtract,
    Multiply,
    Divide,
    Min,
    Max,
}

impl MathOp {
    fn apply(self, a: f32, b: f32) -> f32 {
        match self {
            MathOp::Add => a + b,
            MathOp::Subtract => a - b,
            MathOp::Multiply => a * b,
            // Guard against divide-by-zero: one non-finite sample would poison
            // everything downstream, so a near-zero divisor yields silence.
            MathOp::Divide => {
                if b.abs() < 1.0e-9 {
                    0.0
                } else {
                    a / b
                }
            }
            MathOp::Min => a.min(b),
            MathOp::Max => a.max(b),
        }
    }
}

/// Combines two mono signals (`add`/`subtract`/`multiply`/`divide`/`min`/`max`).
/// fundsp exposes these as combinators, not fixed-arity units, so the net needs this.
#[derive(Clone)]
pub(super) struct MathUnit {
    pub(super) op: MathOp,
}

impl AudioUnit for MathUnit {
    fn inputs(&self) -> usize {
        2
    }

    fn outputs(&self) -> usize {
        1
    }

    fn tick(&mut self, input: &[f32], output: &mut [f32]) {
        output[0] = finite(self.op.apply(input[0], input[1]), 0.0);
    }

    fn process(&mut self, size: usize, input: &BufferRef, output: &mut BufferMut) {
        for i in 0..size {
            let a = input.at_f32(0, i);
            let b = input.at_f32(1, i);
            output.set_f32(0, i, finite(self.op.apply(a, b), 0.0));
        }
    }

    fn route(&mut self, _input: &SignalFrame, _frequency: f64) -> SignalFrame {
        SignalFrame::new(self.outputs())
    }

    fn get_id(&self) -> u64 {
        0x6865_796c_6d61_7468
    }

    fn footprint(&self) -> usize {
        core::mem::size_of::<Self>()
    }
}

/// A unary signal operator (1 in / 1 out) used by the Math nodes (`abs`/`invert`).
#[derive(Clone, Copy)]
pub(super) enum UnaryOp {
    Abs,
    Negate,
}

impl UnaryOp {
    fn apply(self, x: f32) -> f32 {
        match self {
            UnaryOp::Abs => x.abs(),
            UnaryOp::Negate => -x,
        }
    }
}

/// Rectifies or flips one mono signal.
#[derive(Clone)]
pub(super) struct UnaryUnit {
    pub(super) op: UnaryOp,
}

impl AudioUnit for UnaryUnit {
    fn inputs(&self) -> usize {
        1
    }

    fn outputs(&self) -> usize {
        1
    }

    fn tick(&mut self, input: &[f32], output: &mut [f32]) {
        output[0] = finite(self.op.apply(input[0]), 0.0);
    }

    fn process(&mut self, size: usize, input: &BufferRef, output: &mut BufferMut) {
        for i in 0..size {
            output.set_f32(0, i, finite(self.op.apply(input.at_f32(0, i)), 0.0));
        }
    }

    fn route(&mut self, _input: &SignalFrame, _frequency: f64) -> SignalFrame {
        SignalFrame::new(self.outputs())
    }

    fn get_id(&self) -> u64 {
        0x6865_796c_756e_6172
    }

    fn footprint(&self) -> usize {
        core::mem::size_of::<Self>()
    }
}

/// The gain law of a [`DynamicsUnit`].
#[derive(Clone, Copy)]
pub(super) enum GainLaw {
    /// Reduce gain above the threshold (compressor).
    Compress,
    /// Mute the signal below the threshold (noise gate).
    Gate,
}

/// A mono feed-forward dynamics processor (compressor / noise gate).
///
/// fundsp ships neither unit, so this is a small control circuit: an attack/release
/// envelope follower on `|x|` sets a gain applied back to `x`.
/// (See also `SumUnit` for the same `AudioUnit` shape.)
#[derive(Clone)]
pub(super) struct DynamicsUnit {
    law: GainLaw,
    threshold: f32,
    ratio: f32,
    attack: f32,
    release: f32,
    sample_rate: f32,
    env: f32,
}

impl DynamicsUnit {
    pub(super) fn new(law: GainLaw, threshold: f32, ratio: f32, attack: f32, release: f32) -> Self {
        Self {
            law,
            threshold: threshold.max(1e-6),
            ratio: ratio.max(1.0),
            attack: attack.max(0.0),
            release: release.max(0.0),
            sample_rate: 44_100.0,
            env: 0.0,
        }
    }

    /// One-pole coefficient for a time constant in seconds.
    fn coefficient(&self, time: f32) -> f32 {
        if time <= 0.0 {
            1.0
        } else {
            1.0 - (-1.0 / (time * self.sample_rate)).exp()
        }
    }

    /// The current linear gain for the followed envelope.
    fn gain(&self) -> f32 {
        let env = self.env.max(1e-9);
        match self.law {
            GainLaw::Compress => {
                if env <= self.threshold {
                    1.0
                } else {
                    (env / self.threshold).powf(1.0 / self.ratio - 1.0)
                }
            }
            GainLaw::Gate => {
                if env >= self.threshold {
                    1.0
                } else {
                    0.0
                }
            }
        }
    }

    fn process_sample(&mut self, x: f32) -> f32 {
        let level = x.abs();
        let coefficient = if level > self.env {
            self.coefficient(self.attack)
        } else {
            self.coefficient(self.release)
        };
        self.env += coefficient * (level - self.env);
        x * self.gain()
    }
}

impl AudioUnit for DynamicsUnit {
    fn inputs(&self) -> usize {
        1
    }

    fn outputs(&self) -> usize {
        1
    }

    fn set_sample_rate(&mut self, sample_rate: f64) {
        self.sample_rate = sample_rate as f32;
    }

    fn reset(&mut self) {
        self.env = 0.0;
    }

    fn tick(&mut self, input: &[f32], output: &mut [f32]) {
        output[0] = self.process_sample(input[0]);
    }

    fn process(&mut self, size: usize, input: &BufferRef, output: &mut BufferMut) {
        for i in 0..size {
            let y = self.process_sample(input.at_f32(0, i));
            output.set_f32(0, i, y);
        }
    }

    fn route(&mut self, _input: &SignalFrame, _frequency: f64) -> SignalFrame {
        SignalFrame::new(self.outputs())
    }

    fn get_id(&self) -> u64 {
        0x6865_796c_6973_6564
    }

    fn footprint(&self) -> usize {
        core::mem::size_of::<Self>()
    }
}
