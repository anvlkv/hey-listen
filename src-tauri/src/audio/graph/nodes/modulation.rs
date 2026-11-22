//! Modulation effects: chorus, flanger and phaser.

use super::{def, param, NodeDef};

pub(super) const MODULATION: &[NodeDef] = &[
    def!(
        "chorus",
        "Chorus",
        Modulation,
        ["in"],
        ["out"],
        [
            param("separation", "Spread", 0.015, 0.001, 0.1, 0.001, Some("s")),
            param("variation", "Depth", 0.005, 0.0005, 0.05, 0.001, Some("s")),
            param("rate", "Rate", 0.5, 0.001, 100.0, 0.05, Some("Hz"))
        ],
        "Thickens the signal with several short, modulated delay copies."
    ),
    def!(
        "flanger",
        "Flanger",
        Modulation,
        ["in"],
        ["out"],
        [
            param("feedback", "Feedback", 0.5, -0.95, 0.95, 0.05, None),
            param("min_delay", "Min", 0.005, 0.0, 0.1, 0.001, Some("s")),
            param("max_delay", "Max", 0.01, 0.0, 0.1, 0.001, Some("s")),
            param("rate", "Rate", 0.1, 0.001, 100.0, 0.02, Some("Hz"))
        ],
        "A short, swept delay creating a whooshing comb-filter (jet) effect."
    ),
    def!(
        "phaser",
        "Phaser",
        Modulation,
        ["in"],
        ["out"],
        [
            param("feedback", "Feedback", 0.5, -0.95, 0.95, 0.05, None),
            param("rate", "Rate", 0.1, 0.001, 100.0, 0.02, Some("Hz"))
        ],
        "A swept all-pass cascade creating a notchy phase (swoosh) effect."
    ),
];
