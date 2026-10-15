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
//! - `mix` sums two inputs into one (add more `mix` nodes to combine more sources).
//! - `split`/`join` bridge the mono pipeline to stereo (1->2 / 2->1); `pan`, `panner`,
//!   `rotate`, the stereo reverbs and `limiter_stereo` are 1->2 or 2->2 nodes. The net
//!   itself stays mono, so such nodes must `join` back to mono before `output`.
//! - Every other node is a 1-in/1-out processor, a 0-in/1-out generator, or a
//!   control-input filter/node whose extra inputs are cutoff/Q/gain signals (their
//!   arities match [`kind_arity`]).
//!
//! The implementation is split into focused submodules: [`types`] holds the data
//! types and the node-kind arity table, [`units`] the custom `AudioUnit` implementations
//! fundsp does not ship, [`compile`] the unit palette and the net builder, and
//! [`render`] the PCM entry points.

mod compile;
mod render;
mod types;
mod units;

pub use compile::*;
pub use render::*;
pub use types::*;

#[cfg(test)]
mod tests;
