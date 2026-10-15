//! Graph data types for the fundsp engine: the serializable [`GraphSpec`] and its
//! nodes/edges, the compile [`GraphError`], and the node-kind arity table used to
//! validate ports.

use serde::{Deserialize, Serialize};

/// A serializable fundsp graph, as built by the solid-flow editor.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
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
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub params: Vec<f32>,
}

/// One directed connection between two nodes' ports.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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
serialize_error_as_string!(GraphError);

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
        // Math: binary signal operators (A op B), plus `abs`/`invert` (1 in / 1 out).
        "add" | "subtract" | "multiply" | "divide" | "min" | "max" => (2, 1),
        "abs" | "invert" => (1, 1),
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
