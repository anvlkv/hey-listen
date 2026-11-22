//! Control sources and signal followers, plus the trigger/delay-signal nodes.

use super::{def, param, seconds, NodeDef};

pub(super) const CONTROL: &[NodeDef] = &[
    def!(
        "dc",
        "Constant",
        Control,
        [],
        ["out"],
        [param(
            "value",
            "Value",
            1.0,
            -20_000.0,
            20_000.0,
            0.01,
            None
        )],
        "A constant value (DC) — used to set control inputs; frequency and time inputs read it in their own units."
    ),
    def!(
        "sine_lfo",
        "Sine LFO",
        Control,
        [],
        ["out"],
        [
            param("freq", "Rate", 1.0, 0.001, 100.0, 0.05, Some("Hz")),
            param("amp", "Amount", 1.0, -2.0, 2.0, 0.01, None),
            param("offset", "Offset", 0.0, -1.0, 1.0, 0.01, None)
        ],
        "A slow sine oscillator for modulating parameters."
    ),
    def!(
        "follow",
        "Follow",
        Control,
        ["in"],
        ["out"],
        [seconds("time", "Response", 0.05, 0.001, 10.0)],
        "Follows the signal with a one-pole smoother, gliding sudden jumps."
    ),
    def!(
        "afollow",
        "Follow (attack/release)",
        Control,
        ["in"],
        ["out"],
        [
            seconds("attack", "Attack", 0.01, 0.001, 10.0),
            seconds("release", "Release", 0.1, 0.001, 10.0)
        ],
        "Follows the signal with separate rise (attack) and fall (release) times."
    ),
    def!(
        "hold",
        "Hold",
        Control,
        ["audio", "trigger"],
        ["out"],
        [param(
            "variability",
            "Variability",
            0.1,
            0.0,
            1.0,
            0.01,
            None
        )],
        "Sample-and-hold the signal; input 1 = trigger signal (hold rate in Hz)."
    ),
    def!(
        "tap",
        "Tap delay (cv)",
        Control,
        ["audio", "time"],
        ["out"],
        [
            seconds("min", "Min", 0.0, 0.0, 10.0),
            seconds("max", "Max", 1.0, 0.0, 10.0)
        ],
        "Variable delay; input 1 = delay signal in seconds (clamped to min..max)."
    ),
    def!(
        "tap_linear",
        "Tap delay (linear, cv)",
        Control,
        ["audio", "time"],
        ["out"],
        [
            seconds("min", "Min", 0.0, 0.0, 10.0),
            seconds("max", "Max", 1.0, 0.0, 10.0)
        ],
        "Like Tap delay, with linear interpolation — smooth pitch when the time moves."
    ),
    def!(
        "snoop",
        "Snoop",
        Control,
        ["in"],
        ["out"],
        [param(
            "capacity", "Samples", 512.0, 16.0, 8192.0, 16.0, None
        )],
        "Passes the signal through and shows the latest samples on the node (fundsp `snoop`)."
    ),
];
