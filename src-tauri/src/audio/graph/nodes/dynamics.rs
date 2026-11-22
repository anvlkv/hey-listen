//! Dynamics: the look-ahead limiters, the compressor and the noise gate.

use super::{def, param, NodeDef};

pub(super) const DYNAMICS: &[NodeDef] = &[
    def!(
        "limiter",
        "Limiter",
        Dynamics,
        ["in"],
        ["out"],
        [
            param("attack", "Attack", 0.005, 0.0, 1.0, 0.001, Some("s")),
            param("release", "Release", 0.1, 0.0, 10.0, 0.01, Some("s"))
        ],
        "Prevents the signal from exceeding full scale (look-ahead limiter)."
    ),
    def!(
        "limiter_stereo",
        "Limiter (stereo)",
        Dynamics,
        ["L", "R"],
        ["L", "R"],
        [
            param("attack", "Attack", 0.005, 0.0, 1.0, 0.001, Some("s")),
            param("release", "Release", 0.1, 0.0, 10.0, 0.01, Some("s"))
        ],
        "Stereo look-ahead limiter — holds both channels within full scale."
    ),
    def!(
        "compressor",
        "Compressor",
        Dynamics,
        ["in"],
        ["out"],
        [
            param("threshold", "Thresh", -18.0, -60.0, 0.0, 0.5, Some("dB")),
            param("ratio", "Ratio", 4.0, 1.0, 100.0, 0.1, None),
            param("attack", "Attack", 0.01, 0.0005, 0.5, 0.001, Some("s")),
            param("release", "Release", 0.1, 0.001, 10.0, 0.01, Some("s"))
        ],
        "Reduces dynamic range: quietens peaks that rise above the threshold."
    ),
    def!(
        "gate",
        "Noise gate",
        Dynamics,
        ["in"],
        ["out"],
        [
            param("threshold", "Thresh", -40.0, -80.0, 0.0, 0.5, Some("dB")),
            param("attack", "Attack", 0.002, 0.0005, 0.1, 0.001, Some("s")),
            param("release", "Release", 0.05, 0.001, 10.0, 0.01, Some("s"))
        ],
        "Mutes the signal when it falls below a threshold (downward expander)."
    ),
];
