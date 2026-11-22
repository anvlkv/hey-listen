//! Fixed-parameter filters, stereo placement, shaping and delay.

use super::{def, freq, gain, param, q, seconds_step, shelf_gain, NodeDef};

pub(super) const FILTERS: &[NodeDef] =
    &[
        def!(
            "gain",
            "Gain",
            Processor,
            ["in"],
            ["out"],
            [gain(1.0)],
            "Scales the signal's amplitude."
        ),
        def!(
            "fir3",
            "FIR (3-tap)",
            Processor,
            ["in"],
            ["out"],
            // fundsp's `fir3` takes the desired gain at Nyquist (`0` = full low-pass,
            // `1` = pass-through), so the useful range is 0..1, not an amplitude.
            [param("gain", "Nyquist", 1.0, 0.0, 1.0, 0.01, None)],
            "A short three-tap FIR smoothing filter; the parameter is its gain at Nyquist."
        ),
        def!(
        "convolve",
        "Convolution",
        Processor,
        ["in"],
        ["out"],
        [
            seconds_step("time", "Time", 1.2, 0.01, 4.0, 0.1),
            param("tone", "Tone", 0.5, 0.0, 1.0, 0.01, None)
        ],
        "Convolution reverb: convolves the signal with a synthetic decaying-noise impulse response."
    ),
        def!(
            "lowpass",
            "Low-pass",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q()],
            "Attenuates frequencies above the cutoff."
        ),
        def!(
            "highpass",
            "High-pass",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q()],
            "Attenuates frequencies below the cutoff."
        ),
        def!(
            "bandpass",
            "Band-pass",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q()],
            "Passes a band around the center frequency, attenuating both sides."
        ),
        def!(
            "notch",
            "Notch",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q()],
            "Cuts a narrow band around the center frequency."
        ),
        def!(
            "peak",
            "Peak",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q()],
            "Boosts or cuts a band around the center frequency."
        ),
        def!(
            "allpass",
            "All-pass",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q()],
            "Shifts phase around the center frequency without changing the level."
        ),
        def!(
            "bell",
            "Bell",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q(), shelf_gain(1.0)],
            "Peaking bell EQ: boosts or cuts around the center frequency by a gain."
        ),
        def!(
            "lowshelf",
            "Low shelf",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q(), shelf_gain(0.5)],
            "Boosts or cuts all frequencies below the cutoff by a fixed gain."
        ),
        def!(
            "highshelf",
            "High shelf",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q(), shelf_gain(0.5)],
            "Boosts or cuts all frequencies above the cutoff by a fixed gain."
        ),
        def!(
            "moog",
            "Moog",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q()],
            "Resonant analogue-style low-pass (Moog ladder) with a steep roll-off."
        ),
        def!(
            "butterpass",
            "Butterworth",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0)],
            "Second-order Butterworth low-pass — a maximally flat passband."
        ),
        def!(
            "lowpole",
            "Low-pole",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0)],
            "Gentle one-pole low-pass (6 dB/octave)."
        ),
        def!(
            "highpole",
            "High-pole",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0)],
            "Gentle one-pole high-pass (6 dB/octave)."
        ),
        def!(
            "lowrez",
            "Low-rez",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q()],
            "Resonant two-pole low-pass with a synthetic, 'acid' character."
        ),
        def!(
            "bandrez",
            "Band-rez",
            Processor,
            ["in"],
            ["out"],
            [freq(1_000.0), q()],
            "Resonant two-pole band-pass."
        ),
        def!(
            "resonator",
            "Resonator",
            Processor,
            ["in"],
            ["out"],
            [
                freq(1_000.0),
                param("bandwidth", "BW", 110.0, 0.1, 20_000.0, 1.0, Some("Hz"))
            ],
            "Constant-gain band-pass resonator: rings at the center frequency over a bandwidth."
        ),
        def!(
            "morph",
            "Morph",
            Processor,
            ["in"],
            ["out"],
            [
                freq(1_000.0),
                q(),
                param("morph", "Morph", 0.0, -1.0, 1.0, 0.05, None)
            ],
            "Morphing filter: -1 low-pass, 0 peaking, +1 high-pass."
        ),
        def!(
            "pinkpass",
            "Pink tilt",
            Processor,
            ["in"],
            ["out"],
            [],
            "Tilts the spectrum to a -3 dB/octave (pink) response."
        ),
        def!(
        "allpole_delay",
        "All-pass (delay)",
        Processor,
        ["in"],
        ["out"],
        [param("delay", "Delay", 1.0, 0.01, 1_000.0, 0.1, Some("smp"))],
        "First-order all-pass whose phase shift is set by a delay in samples (must be positive)."
    ),
        def!(
            "biquad",
            "Biquad",
            Processor,
            ["in"],
            ["out"],
            [
                param("a1", "a1", 0.0, -2.0, 2.0, 0.001, None),
                param("a2", "a2", 0.0, -2.0, 2.0, 0.001, None),
                // The feed-forward coefficients are unbounded amplitudes in fundsp.
                param("b0", "b0", 1.0, -16.0, 16.0, 0.001, None),
                param("b1", "b1", 0.0, -16.0, 16.0, 0.001, None),
                param("b2", "b2", 0.0, -16.0, 16.0, 0.001, None)
            ],
            "A general second-order filter defined by explicit coefficients."
        ),
        def!(
            "dcblock",
            "DC block",
            Processor,
            ["in"],
            ["out"],
            [],
            "Removes DC offset (very low frequencies)."
        ),
        def!(
            "delay",
            "Delay",
            Processor,
            ["in"],
            ["out"],
            [param("time", "Time", 0.25, 0.0, 10.0, 0.01, Some("s"))],
            "Delays the signal by a fixed time."
        ),
        def!(
            "clip_to",
            "Clip",
            Processor,
            ["in"],
            ["out"],
            [
                param("min", "Min", -1.0, -4.0, 4.0, 0.01, None),
                param("max", "Max", 1.0, -4.0, 4.0, 0.01, None)
            ],
            "Clamps the signal between a minimum and a maximum level."
        ),
        def!(
            "declick",
            "Declick",
            Processor,
            ["in"],
            ["out"],
            [seconds_step("time", "Time", 0.01, 0.0, 2.0, 0.001)],
            "Fades the signal in over the given time, avoiding a click at the start."
        ),
        def!(
            "dcblock_hz",
            "DC block (Hz)",
            Processor,
            ["in"],
            ["out"],
            [param(
                "cutoff",
                "Cutoff",
                5.0,
                0.0,
                1_000.0,
                1.0,
                Some("Hz")
            )],
            "Removes DC offset below the given cutoff with a one-pole high-pass."
        ),
        def!(
            "pan",
            "Pan",
            Processor,
            ["in"],
            ["L", "R"],
            [param("pan", "Pan", 0.0, -1.0, 1.0, 0.01, None)],
            "Places a mono signal in the stereo field (-1 left, +1 right)."
        ),
        def!(
        "panner",
        "Panner (cv)",
        Processor,
        ["audio", "pan"],
        ["L", "R"],
        [],
        "Widens a mono signal using a control input for position — inputs: signal, pan (-1..1)."
    ),
        def!(
            "rotate",
            "Stereo rotate",
            Processor,
            ["L", "R"],
            ["L", "R"],
            [
                param(
                    "angle",
                    "Angle",
                    0.0,
                    -std::f32::consts::PI,
                    std::f32::consts::PI,
                    0.01,
                    Some("rad"),
                ),
                param("gain", "Gain", 1.0, 0.0, 4.0, 0.01, None)
            ],
            "Rotates the stereo image by an angle, with an overall gain."
        ),
    ];
