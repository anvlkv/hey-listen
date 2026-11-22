//! Routing and graph anchors: `input` / `output`, `mix`, `split`, `join`.

use super::{def, filter_node, NodeDef};

pub(super) const ROUTING: &[NodeDef] = &[
    filter_node!(
        "input",
        "Input",
        Io,
        [],
        ["out"],
        [],
        "Where the mono signal enters the filter graph."
    ),
    def!(
        "output",
        "Output",
        Io,
        ["in"],
        [],
        [],
        "Where the graph's mono result is read."
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
