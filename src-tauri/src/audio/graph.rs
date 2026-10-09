//! fundsp graph engine: compile a `GraphSpec` (built in the solid-flow editor) to
//! a fundsp [`Net`], apply it to PCM, and render synth graphs to PCM.
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

use std::collections::{HashMap, HashSet};

use fundsp::prelude64::*;
use serde::{Deserialize, Serialize};

/// A serializable fundsp graph, as built by the solid-flow editor.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GraphSpec {
    #[serde(default)]
    pub nodes: Vec<GraphNode>,
    #[serde(default)]
    pub edges: Vec<GraphEdge>,
}

impl GraphSpec {
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}

/// One node: a `kind` (see [`kind_arity`]) plus positional `params`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub params: Vec<f32>,
}

/// One directed connection between two nodes' ports.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub from: String,
    #[serde(default)]
    pub from_port: usize,
    pub to: String,
    #[serde(default)]
    pub to_port: usize,
}

/// Errors produced while compiling a graph.
#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("unknown node kind: {0}")]
    UnknownKind(String),
    #[error("the graph needs an input node to receive the signal")]
    MissingInput,
    #[error("the graph needs an output node")]
    NoOutput,
    #[error("the graph must contain exactly one '{0}' node")]
    DuplicateAnchor(String),
    #[error("the '{0}' node is only valid in a filter graph")]
    InputInSynth(String),
    #[error("an edge references the unknown node '{0}'")]
    UnknownNode(String),
    #[error("an edge uses an invalid port: {0}")]
    BadEdge(String),
    #[error("two connections feed the same input ({0}); each input takes one source")]
    InputConflict(String),
    #[error("the graph contains a connection cycle")]
    Cycle,
    #[error("could not stream rendered audio: {0}")]
    Stream(String),
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
impl Serialize for GraphError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Whether a kind is the filter graph's entry point.
pub fn is_input_kind(kind: &str) -> bool {
    kind == "input"
}

/// The internal input/output arity of a node kind, or `None` if unknown.
///
/// `input`/`output` are internally pass-throughs (they are anchored to the net's
/// global input/output), which is why they report one input/output here even though
/// the editor shows them with a single visible port.
pub fn kind_arity(kind: &str) -> Option<(usize, usize)> {
    Some(match kind {
        "input" | "output" => (1, 1),
        "mix" => (2, 1),
        // Stereo / routing (the net's global I/O stays mono — `join` back to mono
        // before `output`). `1->2`: split/pan; `2->1`: join; `2->2`: stereo processors.
        "join" => (2, 1),
        "split" | "pan" => (1, 2),
        "panner" | "rotate" | "reverb_stereo" | "reverb2_stereo" | "reverb3_stereo"
        | "reverb4_stereo" | "limiter_stereo" => (2, 2),
        // Fixed-parameter filters and other 1-in/1-out processors.
        "gain" | "lowpass" | "highpass" | "bandpass" | "notch" | "peak" | "allpass" | "bell"
        | "lowshelf" | "highshelf" | "moog" | "butterpass" | "lowpole" | "highpole" | "lowrez"
        | "bandrez" | "resonator" | "morph" | "pinkpass" | "allpole_delay" | "biquad"
        | "dcblock" | "delay" | "limiter" | "compressor" | "gate" | "chorus" | "flanger"
        | "phaser" | "schroeder" => (1, 1),
        // Control-input filter variants. Input 0 is audio; later inputs are signals.
        "butterpass_cv" | "lowpole_cv" | "highpole_cv" | "allpole_cv" | "schroeder_cv" => (2, 1),
        "lowpass_cv" | "highpass_cv" | "bandpass_cv" | "notch_cv" | "peak_cv" | "allpass_cv"
        | "moog_cv" | "lowrez_cv" | "bandrez_cv" | "resonator_cv" => (3, 1),
        "bell_cv" | "lowshelf_cv" | "highshelf_cv" | "morph_cv" => (4, 1),
        "dc" | "sine_lfo" | "white" | "pink" | "brown" | "mls" | "sine" | "saw" | "square"
        | "triangle" | "organ" | "hammond" | "soft_saw" | "pulse" | "poly_saw" | "poly_square"
        | "poly_pulse" | "dsf_saw" | "dsf_square" | "pluck" => (0, 1),
        _ => return None,
    })
}

/// Sums `inputs` mono channels into one (used by `mix`).
#[derive(Clone)]
struct SumUnit {
    inputs: usize,
}

impl AudioUnit for SumUnit {
    fn inputs(&self) -> usize {
        self.inputs
    }

    fn outputs(&self) -> usize {
        1
    }

    fn tick(&mut self, input: &[f32], output: &mut [f32]) {
        let mut sum = 0.0;
        for &sample in input {
            sum += sample;
        }
        output[0] = sum;
    }

    fn process(&mut self, size: usize, input: &BufferRef, output: &mut BufferMut) {
        for i in 0..size {
            let mut sum = 0.0;
            for channel in 0..self.inputs {
                sum += input.at_f32(channel, i);
            }
            output.set_f32(0, i, sum);
        }
    }

    fn route(&mut self, _input: &SignalFrame, _frequency: f64) -> SignalFrame {
        SignalFrame::new(self.outputs())
    }

    fn get_id(&self) -> u64 {
        0x6865_796c_6973_656e
    }

    fn footprint(&self) -> usize {
        core::mem::size_of::<Self>()
    }
}

fn finite(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

/// The gain law of a [`DynamicsUnit`].
#[derive(Clone, Copy)]
enum GainLaw {
    /// Reduce gain above the threshold (compressor).
    Compress,
    /// Mute the signal below the threshold (noise gate).
    Gate,
}

/// A mono feed-forward dynamics processor (compressor / noise gate).
///
/// fundsp ships neither unit, so this is a small control circuit: an attack/release
/// envelope follower on `|x|` sets a gain applied back to `x`.
/// (See also `SumUnit` for the same `AudioUnit` shape.)
#[derive(Clone)]
struct DynamicsUnit {
    law: GainLaw,
    threshold: f32,
    ratio: f32,
    attack: f32,
    release: f32,
    sample_rate: f32,
    env: f32,
}

impl DynamicsUnit {
    fn new(law: GainLaw, threshold: f32, ratio: f32, attack: f32, release: f32) -> Self {
        Self {
            law,
            threshold: threshold.max(1e-6),
            ratio: ratio.max(1.0),
            attack: attack.max(0.0),
            release: release.max(0.0),
            sample_rate: 44_100.0,
            env: 0.0,
        }
    }

    /// One-pole coefficient for a time constant in seconds.
    fn coefficient(&self, time: f32) -> f32 {
        if time <= 0.0 {
            1.0
        } else {
            1.0 - (-1.0 / (time * self.sample_rate)).exp()
        }
    }

    /// The current linear gain for the followed envelope.
    fn gain(&self) -> f32 {
        let env = self.env.max(1e-9);
        match self.law {
            GainLaw::Compress => {
                if env <= self.threshold {
                    1.0
                } else {
                    (env / self.threshold).powf(1.0 / self.ratio - 1.0)
                }
            }
            GainLaw::Gate => {
                if env >= self.threshold {
                    1.0
                } else {
                    0.0
                }
            }
        }
    }

    fn process_sample(&mut self, x: f32) -> f32 {
        let level = x.abs();
        let coefficient = if level > self.env {
            self.coefficient(self.attack)
        } else {
            self.coefficient(self.release)
        };
        self.env += coefficient * (level - self.env);
        x * self.gain()
    }
}

impl AudioUnit for DynamicsUnit {
    fn inputs(&self) -> usize {
        1
    }

    fn outputs(&self) -> usize {
        1
    }

    fn set_sample_rate(&mut self, sample_rate: f64) {
        self.sample_rate = sample_rate as f32;
    }

    fn reset(&mut self) {
        self.env = 0.0;
    }

    fn tick(&mut self, input: &[f32], output: &mut [f32]) {
        output[0] = self.process_sample(input[0]);
    }

    fn process(&mut self, size: usize, input: &BufferRef, output: &mut BufferMut) {
        for i in 0..size {
            let y = self.process_sample(input.at_f32(0, i));
            output.set_f32(0, i, y);
        }
    }

    fn route(&mut self, _input: &SignalFrame, _frequency: f64) -> SignalFrame {
        SignalFrame::new(self.outputs())
    }

    fn get_id(&self) -> u64 {
        0x6865_796c_6973_6564
    }

    fn footprint(&self) -> usize {
        core::mem::size_of::<Self>()
    }
}

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

/// Apply a filter graph to mono PCM (sample-for-sample), returning the filtered
/// signal. Used before preview and (from M4) before analysis.
pub fn apply_mono(
    spec: &GraphSpec,
    input: &[f32],
    sample_rate: u32,
) -> Result<Vec<f32>, GraphError> {
    let mut net = build(spec, 1, sample_rate)?;
    net.reset();
    let mut output = Vec::with_capacity(input.len());
    for &sample in input {
        output.push(net.filter_mono(sample));
    }
    Ok(output)
}

/// Render a synth graph to mono PCM (`seconds` at `sample_rate`).
pub fn render_mono(
    spec: &GraphSpec,
    seconds: f64,
    sample_rate: u32,
) -> Result<Vec<f32>, GraphError> {
    let frames = (seconds.max(0.0) * f64::from(sample_rate)).round() as usize;
    let mut net = build(spec, 0, sample_rate)?;
    net.reset();
    let mut output = Vec::with_capacity(frames);
    for _ in 0..frames {
        output.push(net.get_mono());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, kind: &str, params: &[f32]) -> GraphNode {
        GraphNode {
            id: id.to_string(),
            kind: kind.to_string(),
            params: params.to_vec(),
        }
    }

    fn edge(from: &str, to: &str) -> GraphEdge {
        GraphEdge {
            from: from.to_string(),
            from_port: 0,
            to: to.to_string(),
            to_port: 0,
        }
    }

    fn edge_to(from: &str, from_port: usize, to: &str, to_port: usize) -> GraphEdge {
        GraphEdge {
            from: from.to_string(),
            from_port,
            to: to.to_string(),
            to_port,
        }
    }

    #[test]
    fn gain_filter_scales_the_signal() {
        let spec = GraphSpec {
            nodes: vec![
                node("in", "input", &[]),
                node("g", "gain", &[0.5]),
                node("out", "output", &[]),
            ],
            edges: vec![edge("in", "g"), edge("g", "out")],
        };
        let output = apply_mono(&spec, &vec![1.0f32; 128], 48_000).expect("apply");
        assert_eq!(output.len(), 128);
        for value in output {
            assert!((value - 0.5).abs() < 1e-6, "got {value}");
        }
    }

    #[test]
    fn lowpass_passes_dc_and_attenuates_high_frequency() {
        let spec = GraphSpec {
            nodes: vec![
                node("in", "input", &[]),
                node("lp", "lowpass", &[1_000.0, 0.707]),
                node("out", "output", &[]),
            ],
            edges: vec![edge("in", "lp"), edge("lp", "out")],
        };
        let out = apply_mono(&spec, &vec![1.0f32; 4_000], 48_000).unwrap();
        assert!(
            (out[out.len() - 1] - 1.0).abs() < 0.05,
            "dc = {}",
            out[out.len() - 1]
        );

        let nyquist: Vec<f32> = (0..4_000)
            .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        let out = apply_mono(&spec, &nyquist, 48_000).unwrap();
        let peak = out.iter().skip(200).fold(0f32, |acc, s| acc.max(s.abs()));
        assert!(peak < 0.1, "high frequency leaked: {peak}");
    }

    #[test]
    fn control_input_lowpass_passes_dc() {
        // `lowpass_cv` takes (audio, cutoff, Q): a control-driven low-pass.
        let spec = GraphSpec {
            nodes: vec![
                node("in", "input", &[]),
                node("cut", "dc", &[1_000.0]),
                node("q", "dc", &[0.707]),
                node("lp", "lowpass_cv", &[]),
                node("out", "output", &[]),
            ],
            edges: vec![
                edge_to("in", 0, "lp", 0),
                edge_to("cut", 0, "lp", 1),
                edge_to("q", 0, "lp", 2),
                edge("lp", "out"),
            ],
        };
        let out = apply_mono(&spec, &vec![1.0f32; 4_000], 48_000).unwrap();
        assert!(
            (out[out.len() - 1] - 1.0).abs() < 0.05,
            "dc = {}",
            out[out.len() - 1]
        );
    }

    #[test]
    fn compressor_reduces_a_loud_signal() {
        let spec = GraphSpec {
            nodes: vec![
                node("in", "input", &[]),
                node("comp", "compressor", &[-18.0, 4.0, 0.001, 0.05]),
                node("out", "output", &[]),
            ],
            edges: vec![edge("in", "comp"), edge("comp", "out")],
        };
        let out = apply_mono(&spec, &vec![0.9f32; 4_000], 48_000).unwrap();
        // Skip the attack transient; the compressed steady state should be well below 1.
        let tail = &out[out.len() - 200..];
        let peak = tail.iter().fold(0f32, |acc, s| acc.max(s.abs()));
        assert!(peak < 0.5, "compressor did not reduce the level: {peak}");
    }

    #[test]
    fn unwired_filter_is_not_applied() {
        // The low-pass is not wired to the output, so the output is just the input.
        let spec = GraphSpec {
            nodes: vec![
                node("in", "input", &[]),
                node("lp", "lowpass", &[500.0, 0.707]),
                node("out", "output", &[]),
            ],
            edges: vec![edge("in", "out")],
        };
        let out = apply_mono(&spec, &vec![1.0f32; 256], 48_000).unwrap();
        for value in out {
            assert!((value - 1.0).abs() < 1e-6, "got {value}");
        }
    }

    #[test]
    fn missing_input_is_an_error() {
        let spec = GraphSpec {
            nodes: vec![node("out", "output", &[])],
            edges: vec![],
        };
        assert!(matches!(
            build(&spec, 1, 48_000),
            Err(GraphError::MissingInput)
        ));
    }

    #[test]
    fn missing_output_is_an_error() {
        let spec = GraphSpec {
            nodes: vec![node("osc", "sine", &[440.0])],
            edges: vec![],
        };
        assert!(matches!(build(&spec, 0, 48_000), Err(GraphError::NoOutput)));
    }

    #[test]
    fn synth_renders_a_sine() {
        let spec = GraphSpec {
            nodes: vec![node("osc", "sine", &[440.0]), node("out", "output", &[])],
            edges: vec![edge("osc", "out")],
        };
        let samples = render_mono(&spec, 0.05, 48_000).unwrap();
        assert_eq!(samples.len(), 2_400);
        let peak = samples.iter().fold(0f32, |acc, s| acc.max(s.abs()));
        assert!(peak > 0.9, "expected a full-scale sine, peak = {peak}");
    }

    #[test]
    fn mix_sums_two_generators() {
        let spec = GraphSpec {
            nodes: vec![
                node("a", "dc", &[0.25]),
                node("b", "dc", &[0.5]),
                node("mix", "mix", &[]),
                node("out", "output", &[]),
            ],
            edges: vec![
                edge_to("a", 0, "mix", 0),
                edge_to("b", 0, "mix", 1),
                edge("mix", "out"),
            ],
        };
        for value in render_mono(&spec, 0.001, 48_000).unwrap() {
            assert!((value - 0.75).abs() < 1e-6, "got {value}");
        }
    }

    #[test]
    fn input_in_synth_graph_is_rejected() {
        let spec = GraphSpec {
            nodes: vec![node("in", "input", &[]), node("out", "output", &[])],
            edges: vec![edge("in", "out")],
        };
        assert!(matches!(
            build(&spec, 0, 48_000),
            Err(GraphError::InputInSynth(_))
        ));
    }

    #[test]
    fn two_edges_into_one_input_are_rejected() {
        let spec = GraphSpec {
            nodes: vec![
                node("a", "dc", &[0.5]),
                node("b", "dc", &[0.5]),
                node("g", "gain", &[1.0]),
                node("out", "output", &[]),
            ],
            edges: vec![edge("a", "g"), edge("b", "g"), edge("g", "out")],
        };
        assert!(matches!(
            build(&spec, 0, 48_000),
            Err(GraphError::InputConflict(_))
        ));
    }

    #[test]
    fn cycles_are_rejected() {
        // Two `mix` nodes feed each other on distinct ports (no input conflict), so
        // this is a genuine cycle: `a` -> `b` -> `a`.
        let spec = GraphSpec {
            nodes: vec![
                node("a", "mix", &[]),
                node("b", "mix", &[]),
                node("out", "output", &[]),
            ],
            edges: vec![edge("a", "b"), edge("b", "a"), edge("a", "out")],
        };
        assert!(matches!(build(&spec, 0, 48_000), Err(GraphError::Cycle)));
    }

    #[test]
    fn split_then_join_is_identity() {
        // `input` -> `split` (1->2) -> `join` (2->1) -> `output`: the two copies of
        // the mono signal average straight back to the input.
        let spec = GraphSpec {
            nodes: vec![
                node("in", "input", &[]),
                node("sp", "split", &[]),
                node("jo", "join", &[]),
                node("out", "output", &[]),
            ],
            edges: vec![
                edge_to("in", 0, "sp", 0),
                edge_to("sp", 0, "jo", 0),
                edge_to("sp", 1, "jo", 1),
                edge("jo", "out"),
            ],
        };
        let out = apply_mono(&spec, &vec![0.5f32; 256], 48_000).expect("apply");
        assert_eq!(out.len(), 256);
        for value in out {
            assert!((value - 0.5).abs() < 1e-6, "got {value}");
        }
    }

    #[test]
    fn stereo_reverb_graph_compiles_and_runs() {
        // A stereo node (2 in / 2 out) inside the mono pipeline: the `split`/`join`
        // pair bridges the mono net to the reverb and back.
        let spec = GraphSpec {
            nodes: vec![
                node("osc", "sine", &[220.0]),
                node("sp", "split", &[]),
                node("rv", "reverb_stereo", &[10.0, 2.0, 0.5]),
                node("jo", "join", &[]),
                node("out", "output", &[]),
            ],
            edges: vec![
                edge_to("osc", 0, "sp", 0),
                edge_to("sp", 0, "rv", 0),
                edge_to("sp", 1, "rv", 1),
                edge_to("rv", 0, "jo", 0),
                edge_to("rv", 1, "jo", 1),
                edge("jo", "out"),
            ],
        };
        let out = render_mono(&spec, 0.1, 48_000).expect("render");
        assert_eq!(out.len(), 4_800);
        assert!(
            out.iter().all(|s| s.is_finite()),
            "non-finite reverb output"
        );
        let energy: f32 = out.iter().map(|s| s.abs()).sum();
        assert!(energy > 0.0, "reverb produced silence");
    }

    #[test]
    fn centered_pan_then_join_uses_equal_power() {
        // `pan` widens mono to stereo; `join` averages it back. Center pan is
        // equal-power, so the mono result is ~0.707 of the input.
        let spec = GraphSpec {
            nodes: vec![
                node("in", "input", &[]),
                node("p", "pan", &[0.0]),
                node("jo", "join", &[]),
                node("out", "output", &[]),
            ],
            edges: vec![
                edge_to("in", 0, "p", 0),
                edge_to("p", 0, "jo", 0),
                edge_to("p", 1, "jo", 1),
                edge("jo", "out"),
            ],
        };
        let out = apply_mono(&spec, &vec![1.0f32; 256], 48_000).expect("apply");
        let last = out[out.len() - 1];
        assert!((last - 0.707).abs() < 0.05, "centered pan = {last}");
    }
}
