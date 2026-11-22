//! The palette arms added by M40: subsystems, the extra generators and shapers,
//! convolution, the linear tap and the `snoop` tap.
//!
//! Split out of [`super::compile`] so each file stays inside the source-size budget;
//! `make_unit` asks this module first and falls through to the rest of the palette.

use fundsp::prelude64::*;

use super::compile::{build_scoped, CONTROL_SMOOTH};
use super::units::impulse_response;
use super::{GraphError, GraphNode};

/// Build one of M40's node kinds, or `None` when `kind` belongs to the main palette.
pub(super) fn make_unit(
    node: &GraphNode,
    p: &dyn Fn(usize, f32) -> f32,
    scope: &str,
    sample_rate: u32,
) -> Option<Result<Box<dyn AudioUnit>, GraphError>> {
    let smooth = || follow(CONTROL_SMOOTH);
    let unit: Box<dyn AudioUnit> = match node.kind.as_str() {
        // --- Subsystems: a nested graph compiled into its own net ---
        "subgraph" | "feedback" | "oversample" | "resample" => {
            let inner = match node.subgraph.as_deref() {
                Some(inner) => inner,
                None => return Some(Err(GraphError::MissingSubsystem(node.id.clone()))),
            };
            // `resample` resamples a *generator*, so its inner graph takes no input.
            let global_inputs = if node.kind == "resample" { 0 } else { 1 };
            // The editor addresses the subsystem as `system:<parent>/<node>`, so the
            // registry and the tab agree on one spelling (nested systems extend it).
            let nested = format!("system:{scope}/{}", node.id);
            let net = match build_scoped(inner, global_inputs, sample_rate, &nested) {
                Ok(net) => net,
                Err(err) => return Some(Err(err)),
            };
            if node.kind == "resample" {
                Box::new(resample(unit::<U0, U1>(Box::new(net))))
            } else {
                let wrapped = unit::<U1, U1>(Box::new(net));
                match node.kind.as_str() {
                    "feedback" => Box::new(feedback(wrapped)),
                    "oversample" => Box::new(oversample(wrapped)),
                    _ => Box::new(wrapped),
                }
            }
        }

        // --- Extra generators and waveshaping ---
        "ramp" => Box::new(ramp_hz(p(0, 2.0))),
        "rossler" => Box::new(rossler()),
        "lorenz" => Box::new(lorenz()),
        "tanh" => Box::new(shape(Tanh(p(0, 1.0).max(0.01)))),
        "atan" => Box::new(shape(Atan(p(0, 1.0).max(0.01)))),
        "softsign" => Box::new(shape(Softsign(p(0, 1.0).max(0.01)))),
        "crush" => Box::new(shape(Crush(p(0, 8.0).max(1.0)))),
        "soft_crush" => Box::new(shape(SoftCrush(p(0, 8.0).max(1.0)))),

        // --- FIR, convolution and the linear control delay ---
        // fundsp's `fir3` gain is the gain at Nyquist, in 0..1.
        "fir3" => Box::new(fir3(p(0, 1.0).clamp(0.0, 1.0))),
        // Fully wet: the signal becomes its convolution with a synthetic IR.
        "convolve" => Box::new(convolve(
            &impulse_response(p(0, 1.2), p(1, 0.5), sample_rate),
            0,
        )),
        "tap_linear" => {
            let min_delay = p(0, 0.0).clamp(0.0, 10.0);
            let max_delay = p(1, 1.0).clamp(0.0, 10.0).max(min_delay);
            Box::new((pass() | smooth()) >> tap_linear(min_delay, max_delay))
        }

        // The snoop backend passes audio through and ships blocks to the frontend,
        // which the node polls through `graph_snoop`.
        "snoop" => {
            let capacity = p(0, 512.0).clamp(16.0, 8192.0) as usize;
            let (frontend, backend) = snoop(capacity);
            super::snoop::register(scope, &node.id, frontend);
            Box::new(backend)
        }

        _ => return None,
    };
    Some(Ok(unit))
}
