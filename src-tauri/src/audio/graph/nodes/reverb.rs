//! Mono all-pass diffusion (`schroeder`) and the stereo FDN reverbs.

use super::{def, param, NodeDef};

/// A stereo reverb's room size, in metres.
const fn room(minimum: f32) -> super::NodeParam {
    param("room", "Room", minimum, minimum, 30.0, 0.5, Some("m"))
}

/// A reverb's decay time, in seconds.
const fn decay() -> super::NodeParam {
    param("time", "Time", 2.0, 0.01, 20.0, 0.1, Some("s"))
}

/// A reverb mix control (`damping` / `diffusion`).
const fn mix(key: &'static str, label: &'static str) -> super::NodeParam {
    param(key, label, 0.5, 0.0, 1.0, 0.01, None)
}

const fn loop_filter() -> super::NodeParam {
    param(
        "loop_filter",
        "Loop filter",
        8_000.0,
        100.0,
        20_000.0,
        100.0,
        Some("Hz"),
    )
}

pub(super) const REVERB: &[NodeDef] = &[
    def!(
        "schroeder",
        "Schroeder",
        Reverb,
        ["in"],
        ["out"],
        [
            param("coefficient", "Coef", 0.5, -0.95, 0.95, 0.05, None),
            param("time", "Time", 0.01, 0.0, 1.0, 0.001, Some("s"))
        ],
        "An all-pass diffusion element (Schroeder all-pass); stack several to build a reverb."
    ),
    def!(
        "schroeder_cv",
        "Schroeder (cv)",
        Reverb,
        ["audio", "coef"],
        ["out"],
        [param("time", "Time", 0.01, 0.0, 1.0, 0.001, Some("s"))],
        "Schroeder all-pass with a control-driven coefficient — inputs: audio, coefficient."
    ),
    def!(
        "reverb_stereo",
        "Reverb",
        Reverb,
        ["L", "R"],
        ["L", "R"],
        [room(10.0), decay(), mix("damping", "Damping")],
        "Stereo room reverb (32-channel FDN) — inputs: left, right; outputs: left, right."
    ),
    def!(
        "reverb2_stereo",
        "Reverb 2 (hq)",
        Reverb,
        ["L", "R"],
        ["L", "R"],
        [
            room(10.0),
            decay(),
            mix("diffusion", "Diffusion"),
            param("mod_speed", "Mod", 1.0, 0.0, 2.0, 0.01, None),
            loop_filter()
        ],
        "High-quality stereo reverb with a damped feedback loop — inputs: left, right."
    ),
    def!(
        "reverb3_stereo",
        "Reverb 3",
        Reverb,
        ["L", "R"],
        ["L", "R"],
        [decay(), mix("diffusion", "Diffusion"), loop_filter()],
        "All-pass-loop stereo reverb — inputs: left, right; outputs: left, right."
    ),
    def!(
        "reverb4_stereo",
        "Reverb 4 (fade)",
        Reverb,
        ["L", "R"],
        ["L", "R"],
        [room(15.0), decay()],
        "Stereo reverb with a slow fade-in envelope — inputs: left, right."
    ),
];
