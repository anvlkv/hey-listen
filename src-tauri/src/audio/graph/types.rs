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

/// One node: a `kind` (see [`super::node_def`]) plus positional `params`.
///
/// A node whose kind is a **subsystem** (see [`super::nodes::NodeDef::subsystem`])
/// carries its own nested graph in `subgraph`; the nested spec has its own mono
/// `input`/`output` anchors, which the subsystem's ports map onto.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub params: Vec<f32>,
    #[serde(default)]
    pub subgraph: Option<Box<GraphSpec>>,
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
    #[error("the node '{0}' has no kind attribute")]
    MissingKind(String),
    #[error("the node '{0}' is declared more than once")]
    DuplicateNode(String),
    #[error("unknown port: {0}")]
    UnknownPort(String),
    #[error("node '{0}' has several ports; name the port on each edge")]
    MissingPort(String),
    #[error("a record node needs a label naming its ports: {0}")]
    MissingLabel(String),
    #[error("the record label does not match the kind's ports: {0}")]
    BadLabel(String),
    #[error("unknown parameter for this node kind: {0}")]
    UnknownParam(String),
    #[error("a parameter value is not a number: {0}")]
    BadParamValue(String),
    #[error("a parameter is outside its range: {0}")]
    ParamOutOfRange(String),
    #[error("invalid graph JSON: {0}")]
    InvalidGraph(String),
    #[error("DOT syntax error: {0}")]
    DotSyntax(String),
    #[error("the graph needs an input node to receive the signal")]
    MissingInput,
    #[error("the graph needs an output node")]
    NoOutput,
    #[error("two Output nodes both read channel {0}")]
    DuplicateOutput(usize),
    #[error("output channel {0} is outside 0..={1}")]
    OutputChannel(usize, usize),
    #[error("input channel {0} is outside -1..={1}")]
    InputChannel(i32, usize),
    #[error("the '{0}' node is only valid in a filter graph")]
    InputInSynth(String),
    #[error("the '{0}' node kind needs a subsystem graph")]
    MissingSubsystem(String),
    #[error("the '{0}' node kind has no editable table")]
    NoTable(String),
    #[error("'{0}' is not a subsystem node in this graph")]
    UnknownSubsystem(String),
    #[error("the '{0}' node kind does not take a subsystem graph")]
    UnexpectedSubsystem(String),
    #[error("a subsystem graph needs exactly one input and one output node")]
    SubsystemAnchors(String),
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
    #[error("{0}")]
    Io(String),
    #[error("the source was replaced before this render finished")]
    Superseded,
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(GraphError);

/// Whether a kind is the filter graph's entry point.
pub fn is_input_kind(kind: &str) -> bool {
    kind == "input"
}
