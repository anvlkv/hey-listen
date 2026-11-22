//! fundsp graph engine: compile a `GraphSpec` (built in the solid-flow editor) to
//! a fundsp `Net`, apply it to PCM, and render synth graphs to PCM.
//!
//! The frontend owns the *editing*; this module owns the *audio net*. The compilation
//! is deliberately a literal **push + connect** translation of the spec:
//!
//! 1. `Net::new(inputs, 1)` — one mono output, one global input for filter graphs.
//! 2. `net.push(unit)` for every node.
//! 3. `net.connect(src, src_port, dst, dst_port)` for every edge. Like a fundsp
//!    `Net`, each input takes **exactly one** source, so two edges into the same
//!    input port are rejected (`GraphError::InputConflict`) rather than silently
//!    overwriting.
//! 4. The `input` node (filter graphs) is fed from the global input; the `output`
//!    node feeds the global output.
//!
//! ## Node model
//!
//! - `input` (filter graphs only) is the graph's entry point; `output` is its exit.
//!   Both are the *only* graph-level anchors — there is no implicit summing, so what
//!   is wired to `output` is exactly what the graph produces.
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

mod compile;
mod dot;
mod extras;
mod nodes;
mod outputs;
mod render;
mod session;
mod snoop;
mod types;
mod units;

pub use compile::*;
pub use dot::{emit, looks_like_dot, parse, parse_file, parse_input, parse_text};
pub use extras::parse_wavetable;
pub use nodes::{
    all as all_nodes, default_params, detail_json, dot_skeleton, is_subsystem, kind_arity,
    list_json, node as node_def, NodeCategory, NodeDef, NodeParam, NodeTable, PortSide,
};
pub use outputs::output_channels;
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
