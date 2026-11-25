//! Channel bookkeeping: which source channel each `input` node reads, and how many
//! channels a graph yields.
//!
//! A filter graph may declare several inputs — one `input` node per source channel it
//! reads, each carrying a `Ch` parameter (`-1` downmixes every source channel) — and
//! several outputs, one `output` node per channel (fundsp `Net::new(inputs, channels)`,
//! `set_source` / `set_output_source`).

use super::{node_def, GraphError, GraphNode, GraphSpec};

/// The channel an `output` node writes (its `Ch` param, rounded, defaulting to 0).
///
/// Clamped, because this is the per-node reading used while building; [`output_channels`]
/// is what validates and rejects a stored value that is out of range.
pub(super) fn output_channel(node: &GraphNode) -> usize {
    declared_channel(node, 0.0).clamp(0.0, max_channel("output") as f32) as usize
}

/// A node's `Ch` param, rounded — or `default` when it is missing or not a number.
fn declared_channel(node: &GraphNode, default: f32) -> f32 {
    let raw = node.params.first().copied().unwrap_or(default);
    if raw.is_finite() {
        raw.round()
    } else {
        default
    }
}

/// The highest `Ch` a kind offers (its `Ch` param's max).
fn max_channel(kind: &str) -> usize {
    node_def(kind)
        .and_then(|def| def.params.first())
        .map_or(0, |param| param.max.max(0.0) as usize)
}

/// How many channels `spec` yields: one per distinct `output` channel, at least 1.
///
/// Rejects an out-of-range or duplicated channel, so a graph cannot silently drop or
/// overwrite an output. A channel nobody claims stays silent.
pub fn output_channels(spec: &GraphSpec) -> Result<usize, GraphError> {
    let max = max_channel("output");
    let mut seen: Vec<usize> = Vec::new();
    for node in spec.nodes.iter().filter(|node| node.kind == "output") {
        let channel = declared_channel(node, 0.0);
        if !(0.0..=max as f32).contains(&channel) {
            return Err(GraphError::OutputChannel(channel as usize, max));
        }
        let channel = channel as usize;
        if seen.contains(&channel) {
            return Err(GraphError::DuplicateOutput(channel));
        }
        seen.push(channel);
    }
    Ok(seen.iter().copied().max().map_or(1, |high| high + 1))
}

/// The source channel each `input` node reads, in **node order** — `None` downmixes.
///
/// That order is the net's global-input order: `compile::build_with_ids` bridges input
/// node `i` to `Global(i)`, so a caller feeding frames must use this order too. Rejects a
/// channel the catalog does not offer; two Inputs on one channel are allowed (both read
/// the same signal).
pub fn input_channels(spec: &GraphSpec) -> Result<Vec<Option<usize>>, GraphError> {
    let max = max_channel("input");
    let mut channels = Vec::new();
    for node in spec
        .nodes
        .iter()
        .filter(|node| super::is_input_kind(&node.kind))
    {
        let declared = declared_channel(node, -1.0);
        if !(-1.0..=max as f32).contains(&declared) {
            return Err(GraphError::InputChannel(declared as i32, max));
        }
        channels.push((declared >= 0.0).then_some(declared as usize));
    }
    Ok(channels)
}
