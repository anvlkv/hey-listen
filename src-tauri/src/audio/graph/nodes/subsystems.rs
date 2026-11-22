//! Subsystem nodes: fundsp combinators that wrap an **inner graph**.
//!
//! Their `GraphNode.subgraph` is the nested spec, edited in its own Workbench tab and
//! written as a nested DOT `subgraph`. `compile` builds the inner net and applies the
//! combinator. See `docs/graph-editor.md` → "Subsystems".

use super::{def, subsystem_node, NodeDef};

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
];
