//! Sound generators (synth graphs only).

use super::{def, freq, param, pitch, synth_node, width, NodeDef, NodeTable};

/// The rows a fresh `wave_synth` starts from: partials 1…16 at amplitude `1/n` (a saw)
/// and no phase offset. Any number of rows is valid — this is just the seed.
static WAVE_ROWS: &[f32] = &[
    1.0, 0.0, 0.5, 0.0, 0.333, 0.0, 0.25, 0.0, 0.2, 0.0, 0.167, 0.0, 0.143, 0.0, 0.125, 0.0, 0.111,
    0.0, 0.1, 0.0, 0.091, 0.0, 0.083, 0.0, 0.077, 0.0, 0.071, 0.0, 0.067, 0.0, 0.063, 0.0,
];

/// The wavetable a `wave_synth` carries: one `Amp`/`Phase` pair per partial.
static WAVE_TABLE: NodeTable = NodeTable {
    key: "harmonics",
    label: "Harmonics",
    columns: &["Amp", "Phase"],
    min: 0.0,
    max: 1.0,
    step: 0.01,
    max_rows: 256,
    default_rows: WAVE_ROWS,
};

/// The `wave_synth` catalog entry: a frequency param plus the variadic table above.
const WAVE_SYNTH: NodeDef = {
    let mut def = synth_node!(
        "wave_synth",
        "Wave synth",
        Generator,
        [],
        ["out"],
        [pitch(440.0)],
        "A user-defined wavetable oscillator. Its table lists one amplitude and phase per \
         partial (any number of rows); edit it in the node's Wavetable tab."
    );
    def.table = Some(&WAVE_TABLE);
    def
};

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
    WAVE_SYNTH,
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
