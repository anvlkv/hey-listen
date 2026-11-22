//! Control-input filter variants: input 0 is the audio, the rest drive cutoff / Q /
//! gain from other signals (feed them from `dc` / `sine_lfo`).

use super::{def, NodeDef};

pub(super) const FILTERS_CV: &[NodeDef] = &[
    def!(
        "lowpass_cv",
        "Low-pass (cv)",
        FilterCv,
        ["audio", "cut", "Q"],
        ["out"],
        [],
        "Low-pass driven by control signals — inputs: audio, cutoff, Q."
    ),
    def!(
        "highpass_cv",
        "High-pass (cv)",
        FilterCv,
        ["audio", "cut", "Q"],
        ["out"],
        [],
        "High-pass driven by control signals — inputs: audio, cutoff, Q."
    ),
    def!(
        "bandpass_cv",
        "Band-pass (cv)",
        FilterCv,
        ["audio", "cut", "Q"],
        ["out"],
        [],
        "Band-pass driven by control signals — inputs: audio, cutoff, Q."
    ),
    def!(
        "notch_cv",
        "Notch (cv)",
        FilterCv,
        ["audio", "cut", "Q"],
        ["out"],
        [],
        "Notch driven by control signals — inputs: audio, cutoff, Q."
    ),
    def!(
        "peak_cv",
        "Peak (cv)",
        FilterCv,
        ["audio", "cut", "Q"],
        ["out"],
        [],
        "Peaking filter driven by control signals — inputs: audio, cutoff, Q."
    ),
    def!(
        "allpass_cv",
        "All-pass (cv)",
        FilterCv,
        ["audio", "cut", "Q"],
        ["out"],
        [],
        "All-pass driven by control signals — inputs: audio, cutoff, Q."
    ),
    def!(
        "bell_cv",
        "Bell (cv)",
        FilterCv,
        ["audio", "cut", "Q", "gain"],
        ["out"],
        [],
        "Bell EQ driven by control signals — inputs: audio, cutoff, Q, gain."
    ),
    def!(
        "lowshelf_cv",
        "Low shelf (cv)",
        FilterCv,
        ["audio", "cut", "Q", "gain"],
        ["out"],
        [],
        "Low shelf driven by control signals — inputs: audio, cutoff, Q, gain."
    ),
    def!(
        "highshelf_cv",
        "High shelf (cv)",
        FilterCv,
        ["audio", "cut", "Q", "gain"],
        ["out"],
        [],
        "High shelf driven by control signals — inputs: audio, cutoff, Q, gain."
    ),
    def!(
        "moog_cv",
        "Moog (cv)",
        FilterCv,
        ["audio", "cut", "Q"],
        ["out"],
        [],
        "Moog ladder low-pass driven by control signals — inputs: audio, cutoff, Q."
    ),
    def!(
        "lowrez_cv",
        "Low-rez (cv)",
        FilterCv,
        ["audio", "cut", "Q"],
        ["out"],
        [],
        "Resonant low-pass driven by control signals — inputs: audio, cutoff, Q."
    ),
    def!(
        "bandrez_cv",
        "Band-rez (cv)",
        FilterCv,
        ["audio", "cut", "Q"],
        ["out"],
        [],
        "Resonant band-pass driven by control signals — inputs: audio, cutoff, Q."
    ),
    def!(
        "resonator_cv",
        "Resonator (cv)",
        FilterCv,
        ["audio", "center", "bw"],
        ["out"],
        [],
        "Resonator driven by control signals — inputs: audio, center, bandwidth."
    ),
    def!(
        "morph_cv",
        "Morph (cv)",
        FilterCv,
        ["audio", "cut", "Q", "morph"],
        ["out"],
        [],
        "Morphing filter driven by control signals — inputs: audio, cutoff, Q, morph."
    ),
    def!(
        "butterpass_cv",
        "Butterworth (cv)",
        FilterCv,
        ["audio", "cut"],
        ["out"],
        [],
        "Butterworth low-pass with a control-driven cutoff — inputs: audio, cutoff."
    ),
    def!(
        "lowpole_cv",
        "Low-pole (cv)",
        FilterCv,
        ["audio", "cut"],
        ["out"],
        [],
        "One-pole low-pass with a control-driven cutoff — inputs: audio, cutoff."
    ),
    def!(
        "highpole_cv",
        "High-pole (cv)",
        FilterCv,
        ["audio", "cut"],
        ["out"],
        [],
        "One-pole high-pass with a control-driven cutoff — inputs: audio, cutoff."
    ),
    def!(
        "allpole_cv",
        "All-pass (cv)",
        FilterCv,
        ["audio", "delay"],
        ["out"],
        [],
        "All-pass with a control-driven delay — inputs: audio, delay (samples)."
    ),
];
