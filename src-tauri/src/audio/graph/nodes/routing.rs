//! Routing and graph anchors: `input` / `output`, `mix`, `split`, `join`.

use super::{def, filter_node, param, NodeDef};

pub(super) const ROUTING: &[NodeDef] = &[
    filter_node!(
        "input",
        "Input",
        Io,
        [],
        ["out"],
        [param("channel", "Ch", -1.0, -1.0, 15.0, 1.0, None)],
        "Reads one source channel (-1 downmixes them all). Add another Input for another channel."
    ),
    def!(
        "output",
        "Output",
        Io,
        ["in"],
        [],
        [param("channel", "Ch", 0.0, 0.0, 15.0, 1.0, None)],
        "Writes one of the graph's output channels. Add another Output for another channel."
    ),
    def!(
        "mix",
        "Mix",
        Mixer,
        ["A", "B"],
        ["out"],
        [],
        "Sums two signals into one."
    ),
    def!(
        "split",
        "Split",
        Mixer,
        ["in"],
        ["L", "R"],
        [],
        "Copies a mono signal into two identical channels."
    ),
    def!(
        "join",
        "Join",
        Mixer,
        ["L", "R"],
        ["out"],
        [],
        "Averages two channels back into one — use after stereo processing."
    ),
];
