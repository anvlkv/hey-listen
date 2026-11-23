//! Output channels: how many a graph yields, and which channel each `output` node reads.
//!
//! A filter graph may declare several channels — one `output` node per channel, each
//! carrying a `Ch` parameter (fundsp `Net::new(inputs, channels)`, `set_output_source`).

use super::{node_def, GraphError, GraphNode, GraphSpec};

/// The channel an `output` node reads (its `Ch` param, rounded, defaulting to 0).
///
/// Clamped, because this is the per-node reading used while building; [`output_channels`]
/// is what validates and rejects a stored value that is out of range.
pub(super) fn output_channel(node: &GraphNode) -> usize {
    let raw = node.params.first().copied().unwrap_or(0.0);
    let channel = if raw.is_finite() { raw.round() } else { 0.0 };
    channel.clamp(0.0, max_output_channel() as f32) as usize
}

/// The highest channel the catalog's `output` kind offers (its `Ch` param max).
fn max_output_channel() -> usize {
    node_def("output")
        .and_then(|def| def.params.first())
        .map_or(0, |param| param.max.max(0.0) as usize)
}

/// How many channels `spec` yields: one per distinct `output` channel, at least 1.
///
/// Rejects an out-of-range or duplicated channel, so a graph cannot silently drop or
/// overwrite an output. A channel nobody claims stays silent.
pub fn output_channels(spec: &GraphSpec) -> Result<usize, GraphError> {
    let max = max_output_channel();
    let mut seen: Vec<usize> = Vec::new();
    for node in spec.nodes.iter().filter(|node| node.kind == "output") {
        let declared = node.params.first().copied().unwrap_or(0.0);
        let channel = if declared.is_finite() {
            declared.round()
        } else {
            0.0
        };
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
