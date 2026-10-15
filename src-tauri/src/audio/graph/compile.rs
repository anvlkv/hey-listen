//! The node palette ([`make_unit`]) and the net builder ([`build`]).
//!
//! `make_unit` maps one [`GraphNode`] to its fundsp unit — or to one of the custom
//! units in [`super::units`] — and `build` then pushes and connects the nodes into a
//! fundsp [`Net`] (push + connect; see the module docs).

use std::collections::{HashMap, HashSet};

use fundsp::prelude64::*;

use super::units::{finite, DynamicsUnit, GainLaw, MathOp, MathUnit, SumUnit, UnaryOp, UnaryUnit};
use super::{is_input_kind, kind_arity, GraphError, GraphNode, GraphSpec};

/// Halfway response time (seconds) of the one-pole smoother applied to a node's
/// **control-rate** inputs, so live knob moves glide instead of stepping.
///
/// Limitation: this smooths control signals *within* one compiled net. A full net
/// rebuild (e.g. `set_filter_graph` after an edit) still applies the new params as a
/// step — click-free smoothing across rebuilds is out of scope for this item.
const CONTROL_SMOOTH: f32 = 0.01;

/// Build the fundsp unit for one graph node.
fn make_unit(node: &GraphNode) -> Result<Box<dyn AudioUnit>, GraphError> {
    let p = |index: usize, default: f32| {
        finite(node.params.get(index).copied().unwrap_or(default), default)
    };
    // One-pole parameter smoother for control inputs (a fresh node per use).
    let smooth = || follow(CONTROL_SMOOTH);
    let unit: Box<dyn AudioUnit> = match node.kind.as_str() {
        // Anchors are pass-throughs bridged to the net's global input/output.
        "input" | "output" => Box::new(pass()),
        "mix" => Box::new(SumUnit { inputs: 2 }),

        // --- Math (signal arithmetic) ---
        "add" => Box::new(MathUnit { op: MathOp::Add }),
        "subtract" => Box::new(MathUnit {
            op: MathOp::Subtract,
        }),
        "multiply" => Box::new(MathUnit {
            op: MathOp::Multiply,
        }),
        "divide" => Box::new(MathUnit { op: MathOp::Divide }),
        "min" => Box::new(MathUnit { op: MathOp::Min }),
        "max" => Box::new(MathUnit { op: MathOp::Max }),
        "abs" => Box::new(UnaryUnit { op: UnaryOp::Abs }),
        "invert" => Box::new(UnaryUnit {
            op: UnaryOp::Negate,
        }),

        // --- Stereo / routing ---
        // `split`/`join` bridge between the mono pipeline and 2-channel nodes;
        // `pan`/`panner` place a mono signal in the stereo field. `panner`'s pan
        // control input is smoothed (signal passes through untouched).
        "split" => Box::new(split::<U2>()),
        "join" => Box::new(join::<U2>()),
        "pan" => Box::new(pan(p(0, 0.0).clamp(-1.0, 1.0))),
        "panner" => Box::new((pass() | smooth()) >> panner()),
        "rotate" => Box::new(rotate(p(0, 0.0), p(1, 1.0).max(0.0))),
        "limiter_stereo" => Box::new(limiter_stereo(p(0, 0.005).max(0.0), p(1, 0.1).max(0.0))),

        // --- Stereo reverbs (2 in / 2 out) ---
        "reverb_stereo" => Box::new(reverb_stereo(
            p(0, 10.0).max(10.0),
            p(1, 2.0).max(0.0),
            p(2, 0.5).clamp(0.0, 1.0),
        )),
        "reverb2_stereo" => Box::new(reverb2_stereo(
            p(0, 10.0).max(10.0),
            p(1, 2.0).max(0.0),
            p(2, 0.5).clamp(0.0, 1.0),
            p(3, 1.0).max(0.0),
            lowpole_hz(p(4, 8_000.0).max(20.0)),
        )),
        "reverb3_stereo" => Box::new(reverb3_stereo(
            p(0, 2.0).max(0.0),
            p(1, 0.5).clamp(0.0, 1.0),
            lowpole_hz(p(2, 8_000.0).max(20.0)),
        )),
        "reverb4_stereo" => Box::new(reverb4_stereo(p(0, 15.0).max(15.0), p(1, 2.0).max(0.0))),

        "gain" => Box::new(pass() * p(0, 1.0).max(0.0)),
        "lowpass" => Box::new(lowpass_hz(p(0, 1_000.0), p(1, 1.0))),
        "highpass" => Box::new(highpass_hz(p(0, 1_000.0), p(1, 1.0))),
        "bandpass" => Box::new(bandpass_hz(p(0, 1_000.0), p(1, 1.0))),
        "notch" => Box::new(notch_hz(p(0, 1_000.0), p(1, 1.0))),
        "peak" => Box::new(peak_hz(p(0, 1_000.0), p(1, 1.0))),
        "moog" => Box::new(moog_hz(p(0, 1_000.0), p(1, 1.0))),
        "butterpass" => Box::new(butterpass_hz(p(0, 1_000.0))),
        "dcblock" => Box::new(dcblock()),
        "delay" => Box::new(delay(p(0, 0.25).max(0.0))),
        "limiter" => Box::new(limiter(p(0, 0.005).max(0.0), p(1, 0.1).max(0.0))),
        "dc" => Box::new(dc(p(0, 0.0))),
        "sine_lfo" => {
            let freq = p(0, 1.0).max(0.0) as f64;
            let amp = p(1, 1.0) as f64;
            let offset = p(2, 0.0) as f64;
            Box::new(lfo(move |t: f64| offset + amp * sin_hz(freq, t)))
        }
        "white" => Box::new(noise()),
        "pink" => Box::new(pink()),
        "sine" => Box::new(sine_hz(p(0, 440.0))),
        "saw" => Box::new(saw_hz(p(0, 440.0))),
        "square" => Box::new(square_hz(p(0, 440.0))),
        "triangle" => Box::new(triangle_hz(p(0, 440.0))),

        // --- Filter families with fixed parameters (`*_hz` constructors) ---
        "allpass" => Box::new(allpass_hz(p(0, 1_000.0), p(1, 1.0))),
        "bell" => Box::new(bell_hz(p(0, 1_000.0), p(1, 1.0), p(2, 1.0))),
        "lowshelf" => Box::new(lowshelf_hz(p(0, 1_000.0), p(1, 1.0), p(2, 0.5))),
        "highshelf" => Box::new(highshelf_hz(p(0, 1_000.0), p(1, 1.0), p(2, 0.5))),
        "lowpole" => Box::new(lowpole_hz(p(0, 1_000.0))),
        "highpole" => Box::new(highpole_hz(p(0, 1_000.0))),
        "lowrez" => Box::new(lowrez_hz(p(0, 1_000.0), p(1, 1.0))),
        "bandrez" => Box::new(bandrez_hz(p(0, 1_000.0), p(1, 1.0))),
        "resonator" => Box::new(resonator_hz(p(0, 1_000.0), p(1, 110.0))),
        "morph" => Box::new(morph_hz(p(0, 1_000.0), p(1, 1.0), p(2, 0.0))),
        "pinkpass" => Box::new(pinkpass()),
        "allpole_delay" => Box::new(allpole_delay(p(0, 1.0))),
        "biquad" => Box::new(biquad(
            p(0, 0.0),
            p(1, 0.0),
            p(2, 1.0),
            p(3, 0.0),
            p(4, 0.0),
        )),

        // --- Control-input filter variants ---
        // The extra inputs are control signals (feed them from `dc`/`sine_lfo`):
        // lowpass/highpass/bandpass/notch/peak/allpass (audio, cutoff, Q),
        // bell/lowshelf/highshelf (audio, cutoff, Q, gain), morph (audio, cutoff, Q, morph),
        // moog/lowrez/bandrez (audio, cutoff, Q), resonator (audio, center, bandwidth),
        // butterpass/lowpole/highpole (audio, cutoff), allpole (audio, delay in samples).
        //
        // Each control input is routed through a one-pole `follow` smoother (input 0,
        // the audio, passes through untouched) so control-rate moves glide.
        "lowpass_cv" => Box::new((pass() | smooth() | smooth()) >> lowpass()),
        "highpass_cv" => Box::new((pass() | smooth() | smooth()) >> highpass()),
        "bandpass_cv" => Box::new((pass() | smooth() | smooth()) >> bandpass()),
        "notch_cv" => Box::new((pass() | smooth() | smooth()) >> notch()),
        "peak_cv" => Box::new((pass() | smooth() | smooth()) >> peak()),
        "allpass_cv" => Box::new((pass() | smooth() | smooth()) >> allpass()),
        "bell_cv" => Box::new((pass() | smooth() | smooth() | smooth()) >> bell()),
        "lowshelf_cv" => Box::new((pass() | smooth() | smooth() | smooth()) >> lowshelf()),
        "highshelf_cv" => Box::new((pass() | smooth() | smooth() | smooth()) >> highshelf()),
        "moog_cv" => Box::new((pass() | smooth() | smooth()) >> moog()),
        "lowrez_cv" => Box::new((pass() | smooth() | smooth()) >> lowrez()),
        "bandrez_cv" => Box::new((pass() | smooth() | smooth()) >> bandrez()),
        "resonator_cv" => Box::new((pass() | smooth() | smooth()) >> resonator()),
        "morph_cv" => Box::new((pass() | smooth() | smooth() | smooth()) >> morph()),
        "butterpass_cv" => Box::new((pass() | smooth()) >> butterpass()),
        "lowpole_cv" => Box::new((pass() | smooth()) >> lowpole()),
        "highpole_cv" => Box::new((pass() | smooth()) >> highpole()),
        "allpole_cv" => Box::new((pass() | smooth()) >> allpole()),

        // --- Dynamics ---
        // fundsp ships neither a compressor nor a gate, so both use a small custom
        // envelope-follower unit (see `DynamicsUnit`).
        "compressor" => Box::new(DynamicsUnit::new(
            GainLaw::Compress,
            db_amp(p(0, -18.0)),
            p(1, 4.0),
            p(2, 0.01),
            p(3, 0.1),
        )),
        "gate" => Box::new(DynamicsUnit::new(
            GainLaw::Gate,
            db_amp(p(0, -40.0)),
            1.0,
            p(1, 0.002),
            p(2, 0.05),
        )),

        // --- Modulation ---
        "chorus" => Box::new(chorus(0, p(0, 0.015), p(1, 0.005), p(2, 0.5))),
        "flanger" => {
            let feedback = p(0, 0.5).clamp(-0.95, 0.95);
            let min_delay = p(1, 0.005).max(0.0);
            let max_delay = p(2, 0.01).max(min_delay);
            let rate = p(3, 0.1).max(0.0);
            Box::new(flanger(feedback, min_delay, max_delay, move |t: f32| {
                lerp11(min_delay, max_delay, sin_hz(rate, t))
            }))
        }
        "phaser" => {
            let feedback = p(0, 0.5).clamp(-0.95, 0.95);
            let rate = p(1, 0.1).max(0.0);
            Box::new(phaser(feedback, move |t: f32| sin_hz(rate, t) * 0.5 + 0.5))
        }

        // --- Reverb (mono element) ---
        // fundsp's full reverbs are all stereo-only (`reverb*_stereo`, 2 in / 2 out) and
        // cannot compile under the mono net, so only its mono all-pass diffusion element
        // is offered here (stack several to approximate a reverb).
        "schroeder" => Box::new(allnest_c(p(0, 0.5), delay(p(1, 0.01).max(0.0)))),
        "schroeder_cv" => Box::new((pass() | smooth()) >> allnest(delay(p(0, 0.01).max(0.0)))),

        // --- Additional generators ---
        "organ" => Box::new(organ_hz(p(0, 440.0))),
        "hammond" => Box::new(hammond_hz(p(0, 440.0))),
        "soft_saw" => Box::new(soft_saw_hz(p(0, 440.0))),
        "pulse" => Box::new(dc((p(0, 440.0), p(1, 0.5).clamp(0.0, 1.0))) >> pulse()),
        "poly_saw" => Box::new(poly_saw_hz(p(0, 440.0))),
        "poly_square" => Box::new(poly_square_hz(p(0, 440.0))),
        "poly_pulse" => Box::new(poly_pulse_hz(p(0, 440.0), p(1, 0.5).clamp(0.0, 1.0))),
        "dsf_saw" => Box::new(dc(p(0, 440.0)) >> dsf_saw_r(p(1, 0.5).clamp(0.0, 1.0))),
        "dsf_square" => Box::new(dc(p(0, 440.0)) >> dsf_square_r(p(1, 0.5).clamp(0.0, 1.0))),
        "pluck" => {
            Box::new(zero() >> pluck(p(0, 440.0), p(1, 1.0).max(0.0), p(2, 0.5).clamp(0.0, 1.0)))
        }
        "brown" => Box::new(brown()),
        "mls" => Box::new(mls()),

        other => return Err(GraphError::UnknownKind(other.to_string())),
    };
    Ok(unit)
}

/// Compile a [`GraphSpec`] into a fundsp [`Net`] (push + connect).
///
/// `global_inputs` is 1 for a filter graph (the `input` node receives it) and 0 for
/// a synth graph. The net always has exactly one (mono) output, fed by the `output`
/// node.
pub fn build(spec: &GraphSpec, global_inputs: usize, sample_rate: u32) -> Result<Net, GraphError> {
    let mut net = Net::new(global_inputs, 1);

    // 1) Push every node.
    let mut ids: HashMap<&str, NodeId> = HashMap::new();
    let mut kinds: HashMap<&str, &str> = HashMap::new();
    let mut inputs: Vec<&str> = Vec::new();
    let mut outputs: Vec<&str> = Vec::new();
    for node in &spec.nodes {
        let kind = node.kind.as_str();
        if kind_arity(kind).is_none() {
            return Err(GraphError::UnknownKind(node.kind.clone()));
        }
        kinds.insert(node.id.as_str(), kind);
        if is_input_kind(kind) {
            inputs.push(node.id.as_str());
        } else if kind == "output" {
            outputs.push(node.id.as_str());
        }
        let node_id = net.push(make_unit(node)?);
        ids.insert(node.id.as_str(), node_id);
    }

    // 2) Validate the anchors.
    if global_inputs == 1 {
        match inputs.len() {
            0 => return Err(GraphError::MissingInput),
            1 => {}
            _ => return Err(GraphError::DuplicateAnchor("input".to_string())),
        }
    } else if let Some(id) = inputs.first() {
        return Err(GraphError::InputInSynth((*id).to_string()));
    }
    match outputs.len() {
        0 => return Err(GraphError::NoOutput),
        1 => {}
        _ => return Err(GraphError::DuplicateAnchor("output".to_string())),
    }

    // 3) Connect the edges (each input takes exactly one source).
    let mut occupied: HashSet<(NodeId, usize)> = HashSet::new();
    for edge in &spec.edges {
        let from = *ids
            .get(edge.from.as_str())
            .ok_or_else(|| GraphError::UnknownNode(edge.from.clone()))?;
        let to = *ids
            .get(edge.to.as_str())
            .ok_or_else(|| GraphError::UnknownNode(edge.to.clone()))?;
        if from == to {
            return Err(GraphError::Cycle);
        }
        let (_, from_outputs) = kind_arity(kinds[edge.from.as_str()]).unwrap();
        let (to_inputs, _) = kind_arity(kinds[edge.to.as_str()]).unwrap();
        if edge.from_port >= from_outputs || edge.to_port >= to_inputs {
            return Err(GraphError::BadEdge(format!(
                "{}:{} -> {}:{}",
                edge.from, edge.from_port, edge.to, edge.to_port
            )));
        }
        if !occupied.insert((to, edge.to_port)) {
            return Err(GraphError::InputConflict(format!(
                "{}:{}",
                edge.to, edge.to_port
            )));
        }
        net.connect(from, edge.from_port, to, edge.to_port);
    }

    // 4) Bridge the anchors to the net's global input/output.
    if global_inputs == 1 {
        let input_id = ids[inputs[0]];
        net.set_source(input_id, 0, Source::Global(0));
    }
    let output_id = ids[outputs[0]];
    net.set_output_source(0, Source::Local(output_id, 0));

    net.set_sample_rate(sample_rate as f64);
    if net.error().is_some() {
        return Err(GraphError::Cycle);
    }
    net.allocate();
    Ok(net)
}
