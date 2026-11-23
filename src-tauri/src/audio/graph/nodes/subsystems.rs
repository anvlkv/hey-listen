//! Subsystem nodes: fundsp combinators that wrap an **inner graph**, plus `sequence`,
//! which also plays a list of notes through one.
//!
//! Their `GraphNode.subgraph` is the nested spec, edited in its own Workbench tab and
//! written as a nested DOT `subgraph`. `compile` builds the inner net and applies the
//! combinator.

use super::{def, param, subsystem_node, NodeColumn, NodeDef, NodeTable};

/// The rows a fresh `sequence` starts from: an A-minor arpeggio, so the node makes sound
/// before it is edited. `start, dur, midi note, velocity` — any number of rows is valid.
static NOTE_ROWS: &[f32] = &[
    0.0, 0.22, 69.0, 0.85, 0.25, 0.22, 72.0, 0.8, 0.5, 0.22, 76.0, 0.78, 0.75, 0.45, 74.0, 0.82,
    1.25, 0.22, 72.0, 0.75, 1.5, 0.7, 69.0, 0.8,
];

/// A `sequence`'s note table: one scheduled note per row.
static NOTE_TABLE: NodeTable = NodeTable {
    key: "notes",
    label: "Notes",
    columns: &[
        NodeColumn {
            label: "Start",
            min: 0.0,
            max: 64.0,
            step: 0.01,
        },
        NodeColumn {
            label: "Dur",
            min: 0.02,
            max: 16.0,
            step: 0.01,
        },
        NodeColumn {
            label: "Note",
            min: 0.0,
            max: 127.0,
            step: 1.0,
        },
        NodeColumn {
            label: "Vel",
            min: 0.0,
            max: 1.0,
            step: 0.01,
        },
    ],
    max_rows: 256,
    default_rows: NOTE_ROWS,
};

/// The `sequence` catalog entry: a note table played through its nested voice graph.
const SEQUENCE: NodeDef = {
    let mut def = subsystem_node!(
        "sequence",
        "Sequence",
        Generator,
        [],
        ["out"],
        [param("loop", "Loop", 0.0, 0.0, 60.0, 0.25, Some("s"))],
        "Plays its note rows through the nested voice graph. The voice takes one \
         frequency input; Loop 0 plays once, otherwise the pattern repeats."
    );
    def.synth_only = true;
    def.table = Some(&NOTE_TABLE);
    def
};

pub(super) const SUBSYSTEMS: &[NodeDef] = &[
    subsystem_node!(
        "subgraph",
        "Subgraph",
        Subsystem,
        ["in"],
        ["out"],
        [],
        "A nested graph in one node — open its tab to build a reusable chain."
    ),
    subsystem_node!(
        "feedback",
        "Feedback",
        Subsystem,
        ["in"],
        ["out"],
        [],
        "Feeds a nested graph's output back into its input (fundsp `feedback`)."
    ),
    subsystem_node!(
        "oversample",
        "Oversample",
        Subsystem,
        ["in"],
        ["out"],
        [],
        "Runs a nested graph with extra internal oversampling to reduce aliasing."
    ),
    subsystem_node!(
        "resample",
        "Resample",
        Subsystem,
        ["speed"],
        ["out"],
        [],
        "Resamples a nested generator; input 0 is the speed (1 = the original rate)."
    ),
    SEQUENCE,
];
