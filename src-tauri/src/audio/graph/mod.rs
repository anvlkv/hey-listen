//! fundsp graph engine: compile a `GraphSpec` (built in the solid-flow editor) to
//! a fundsp `Net`, apply it to PCM, and render synth graphs to PCM.
//!
//! The frontend owns the *editing*; this module owns the *audio net*. The compilation
//! is deliberately a literal **push + connect** translation of the spec:
//!
//! 1. `Net::new(inputs, channels)` — one global input per `input` node (filter graphs)
//!    or none (synth graphs), one global output per declared channel.
//! 2. `net.push(unit)` for every node.
//! 3. `net.connect(src, src_port, dst, dst_port)` for every edge. Like a fundsp
//!    `Net`, each input takes **exactly one** source, so two edges into the same
//!    input port are rejected (`GraphError::InputConflict`) rather than silently
//!    overwriting.
//! 4. Each `input` node is fed from the global input at **its index**, reading the source
//!    channel its `Ch` param names (`-1` downmixes); each `output` node feeds the channel
//!    its `Ch` names.
//!
//! ## Node model
//!
//! - `input` (filter graphs only) is the graph's entry point; `output` is its exit.
//!   Both are the *only* graph-level anchors — there is no implicit summing, so what
//!   is wired to `output` is exactly what the graph produces. A graph may carry several
//!   of each: one `input` per source channel it reads, one `output` per channel it yields
//!   (see [`channels`]).
//! - [`nodes`] is the single node catalog: arity, port names, parameter specs,
//!   category and hint. The compiler, the editor palette and the DOT interchange
//!   all read it, so `kind_arity` is just the catalog's port count.
//! - [`dot`] is the canonical text form (`GraphSpec → DOT → GraphSpec` is identity).
//!
//! The implementation is split into focused submodules: [`types`] holds the data
//! types, [`nodes`] the catalog, [`units`] the custom `AudioUnit` implementations
//! fundsp does not ship, [`compile`] the unit palette and the net builder, [`dot`]
//! the text interchange, [`render`] the PCM entry points, and [`session`] the
//! per-window net that a parameter-only edit patches instead of recompiling.

mod channels;
mod compile;
mod dot;
mod extras;
mod nodes;
mod render;
mod sequence;
mod session;
mod snoop;
mod types;
mod units;

pub use channels::{input_channels, output_channels};
pub use compile::*;
pub use dot::{emit, looks_like_dot, parse, parse_file, parse_input, parse_text};
pub use extras::parse_table_text;
pub use nodes::{
    all as all_nodes, default_params, detail_json, dot_skeleton, is_subsystem, kind_arity,
    list_json, node as node_def, NodeCategory, NodeColumn, NodeDef, NodeParam, NodeTable, PortSide,
};
pub use render::*;
pub use session::*;
pub use snoop::{read as snoop_read, SnoopView};
pub use types::*;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_dot;
#[cfg(test)]
mod tests_nodes;
#[cfg(test)]
mod tests_output;
#[cfg(test)]
mod tests_tables;
