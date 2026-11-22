//! Sound generators (synth graphs only).

use super::{def, freq, param, pitch, synth_node, width, NodeDef};

pub(super) const GENERATORS: &[NodeDef] = &[
    synth_node!(
        "sine",
        "Sine",
        Generator,
        [],
        ["out"],
        [freq(440.0)],
        "A pure sine oscillator at the given frequency."
    ),
    synth_node!(
        "saw",
        "Saw",
        Generator,
        [],
        ["out"],
        [freq(440.0)],
        "A band-limited sawtooth oscillator at the given frequency."
    ),
    synth_node!(
        "square",
        "Square",
        Generator,
        [],
        ["out"],
        [freq(440.0)],
        "A band-limited square oscillator at the given frequency."
    ),
    synth_node!(
        "triangle",
        "Triangle",
        Generator,
        [],
        ["out"],
        [freq(440.0)],
        "A triangle oscillator at the given frequency."
    ),
    synth_node!(
        "ramp",
        "Ramp",
        Generator,
        [],
        ["out"],
        [freq(2.0)],
        "A rising 0→1 ramp (phasor) that restarts on each cycle."
    ),
    synth_node!(
        "rossler",
        "Rössler",
        Generator,
        [],
        ["out"],
        [],
        "A chaotic Rössler attractor — a slowly wandering, unstable tone."
    ),
    synth_node!(
        "lorenz",
        "Lorenz",
        Generator,
        [],
        ["out"],
        [],
        "A chaotic Lorenz attractor — an evolving, turbulent signal."
    ),
    synth_node!(
        "organ",
        "Organ",
        Generator,
        [],
        ["out"],
        [freq(440.0)],
        "An additive organ-like tone at the given frequency."
    ),
    synth_node!(
        "hammond",
        "Hammond",
        Generator,
        [],
        ["out"],
        [freq(440.0)],
        "A tone with the drawbar-like harmonics of a Hammond organ."
    ),
    synth_node!(
        "soft_saw",
        "Soft saw",
        Generator,
        [],
        ["out"],
        [freq(440.0)],
        "A sawtooth wave with reduced high-frequency harshness."
    ),
    synth_node!(
        "pulse",
        "Pulse",
        Generator,
        [],
        ["out"],
        [freq(440.0), width()],
        "A rectangular pulse wave with an adjustable width."
    ),
    synth_node!(
        "poly_saw",
        "Poly saw",
        Generator,
        [],
        ["out"],
        [freq(440.0)],
        "A band-limited (PolyBLEP) sawtooth wave."
    ),
    synth_node!(
        "poly_square",
        "Poly square",
        Generator,
        [],
        ["out"],
        [freq(440.0)],
        "A band-limited (PolyBLEP) square wave."
    ),
    synth_node!(
        "poly_pulse",
        "Poly pulse",
        Generator,
        [],
        ["out"],
        [freq(440.0), width()],
        "A band-limited (PolyBLEP) pulse wave with an adjustable width."
    ),
    synth_node!(
        "dsf_saw",
        "DSF saw",
        Generator,
        [],
        ["out"],
        [
            pitch(440.0),
            param("roughness", "Rough", 0.5, 0.0, 1.0, 0.01, None)
        ],
        "Additive sawtooth from a discrete summation formula; roughness sets brightness."
    ),
    synth_node!(
        "dsf_square",
        "DSF square",
        Generator,
        [],
        ["out"],
        [
            pitch(440.0),
            param("roughness", "Rough", 0.5, 0.0, 1.0, 0.01, None)
        ],
        "Additive square wave from a discrete summation formula; roughness sets brightness."
    ),
    synth_node!(
        "pluck",
        "Pluck",
        Generator,
        [],
        ["out"],
        [
            pitch(440.0),
            param("decay", "Decay", 1.0, 0.0, 8.0, 0.05, Some("1/s")),
            param("damping", "Damping", 0.5, 0.0, 1.0, 0.01, None)
        ],
        "A plucked-string (Karplus–Strong) tone that decays over time."
    ),
    synth_node!(
        "white",
        "White noise",
        Generator,
        [],
        ["out"],
        [],
        "Full-bandwidth white noise."
    ),
    synth_node!(
        "pink",
        "Pink noise",
        Generator,
        [],
        ["out"],
        [],
        "Pink noise (-3 dB/octave)."
    ),
    synth_node!(
        "brown",
        "Brown noise",
        Generator,
        [],
        ["out"],
        [],
        "Brown (red) noise (-6 dB/octave)."
    ),
    synth_node!(
        "mls",
        "MLS",
        Generator,
        [],
        ["out"],
        [],
        "A deterministic pseudo-random ±1 maximum-length sequence."
    ),
    synth_node!(
        "zero",
        "Zero",
        Generator,
        [],
        ["out"],
        [],
        "Outputs silence — a constant zero to drive an otherwise unused input."
    ),
    synth_node!(
        "impulse",
        "Impulse",
        Generator,
        [],
        ["out"],
        [],
        "A single full-scale sample at time zero, silent afterwards."
    ),
];
