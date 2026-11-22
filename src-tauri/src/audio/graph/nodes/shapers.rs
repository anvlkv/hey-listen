//! Waveshaping (`fundsp::shape`): saturators and bit-crushers.

use super::{def, param, NodeDef, NodeParam};

/// A saturator's drive / threshold (any positive hardness in fundsp).
const fn drive() -> NodeParam {
    param("threshold", "Drive", 1.0, 0.01, 100.0, 0.1, None)
}

/// A crusher's quantization levels per unit.
const fn levels() -> NodeParam {
    param("levels", "Levels", 8.0, 1.0, 1024.0, 1.0, None)
}

pub(super) const SHAPERS: &[NodeDef] = &[
    def!(
        "tanh",
        "Tanh drive",
        Processor,
        ["in"],
        ["out"],
        [drive()],
        "Soft-clips the signal with a hyperbolic tangent."
    ),
    def!(
        "atan",
        "Atan drive",
        Processor,
        ["in"],
        ["out"],
        [drive()],
        "Soft-clips the signal with an arctangent curve."
    ),
    def!(
        "softsign",
        "Softsign drive",
        Processor,
        ["in"],
        ["out"],
        [drive()],
        "Soft-clips the signal with x / (1 + |x|)."
    ),
    def!(
        "crush",
        "Bit crush",
        Processor,
        ["in"],
        ["out"],
        [levels()],
        "Quantizes the signal to a number of discrete levels."
    ),
    def!(
        "soft_crush",
        "Soft crush",
        Processor,
        ["in"],
        ["out"],
        [levels()],
        "Quantizes the signal to discrete levels with a softened step."
    ),
];
