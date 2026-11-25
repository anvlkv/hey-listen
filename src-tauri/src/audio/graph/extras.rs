//! The palette arms added by M40: subsystems, the extra generators and shapers,
//! convolution, the linear tap, the `snoop` tap and the `sequence` player.
//!
//! Split out of [`super::compile`] so each file stays inside the source-size budget;
//! `make_unit` asks this module first and falls through to the rest of the palette.

use fundsp::prelude64::*;

use super::compile::{build_scoped, CONTROL_SMOOTH};
use super::units::impulse_response;
use super::{GraphError, GraphNode};

/// Read table rows from a text file: **one row per line**, `columns` values per row,
/// separated by commas, semicolons or whitespace. A header line is skipped because
/// non-numeric tokens are ignored; a short line is padded with 0 and extra values are
/// dropped, so every line contributes exactly one whole row. The caller clamps each
/// column to its own [`NodeColumn`](super::NodeColumn) range.
pub fn parse_table_text(text: &str, columns: usize) -> Vec<f32> {
    let width = std::cmp::max(columns, 1);
    let mut rows = Vec::new();
    for line in text.lines() {
        let mut values = line
            .split(|ch: char| ch.is_whitespace() || ch == ',' || ch == ';')
            .filter_map(|token| token.trim().parse::<f32>().ok())
            .filter(|value| value.is_finite());
        let Some(first) = values.next() else {
            continue;
        };
        rows.push(first);
        for _ in 1..width {
            rows.push(values.next().unwrap_or(0.0));
        }
    }
    rows
}

/// The amplitude and phase of each partial from a `wave_synth` node's table tail.
fn harmonic_rows(node: &GraphNode) -> (Vec<f64>, Vec<f64>) {
    let mut amps = Vec::new();
    let mut phases = Vec::new();
    for pair in super::nodes::table_rows(node, "wave_synth").chunks(2) {
        amps.push(pair[0].clamp(0.0, 1.0) as f64);
        phases.push(pair.get(1).copied().unwrap_or(0.0).clamp(0.0, 1.0) as f64);
    }
    (amps, phases)
}

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
            // The subsystem is wrapped in a 1-in/1-out unit, so its inner graph must be
            // exactly that — one `input` (none for a generator) and one `output` node.
            if net.inputs() != global_inputs || net.outputs() != 1 {
                return Some(Err(GraphError::SubsystemAnchors(node.id.clone())));
            }
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

        // --- Sequence: the note table played through one voice graph per note ---
        "sequence" => {
            let looped = p(0, 0.0).max(0.0);
            match super::sequence::make_unit(node, looped, scope, sample_rate) {
                Ok(unit) => unit,
                Err(err) => return Some(Err(err)),
            }
        }

        // --- Extra generators and waveshaping ---
        "ramp" => Box::new(ramp_hz(p(0, 2.0))),
        "rossler" => Box::new(rossler()),
        "lorenz" => Box::new(lorenz()),
        // A user-defined wavetable: the params past `freq` are `amp, phase` rows, any
        // number of them (fundsp takes an amplitude and a phase per partial). fundsp
        // normalizes the table, so the numbers set the timbre, not the level.
        "wave_synth" => {
            let (amps, phases) = harmonic_rows(node);
            let table = Wavetable::new(
                20.0,
                20_000.0,
                4.0,
                &|i: u32| phases.get(i as usize).copied().unwrap_or(0.0),
                &|_pitch: f64, i: u32| {
                    // Partial 0 is DC; partial n is row `n - 1`.
                    if i == 0 {
                        0.0
                    } else {
                        amps.get(i as usize - 1).copied().unwrap_or(0.0)
                    }
                },
            );
            let table = std::sync::Arc::new(table);
            Box::new(dc(p(0, 440.0).max(1.0)) >> An(WaveSynth::<U1>::new(table)))
        }
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
