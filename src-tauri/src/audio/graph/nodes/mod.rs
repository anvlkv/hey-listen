//! The single node catalog for the filter and synth graphs (M39, ADR-36).
//!
//! One Rust table says what a node kind is: its arity, port names, parameter
//! specs, palette category, hint, and which editor may offer it. The DOT parser,
//! the compiler's port validation, the CLI `nodes` command and — through the
//! generated `src/bindings/nodeCatalog.json` — the editor palette all derive from
//! it, so a kind is added in exactly one place (plus its `make_unit` arm).
//!
//! The table is split into per-family modules to stay inside the source-size
//! budget; [`all`] concatenates them in palette order.
//!
//! ## fundsp coverage
//!
//! Every composable fundsp node family has a kind here. The ones fundsp expresses as
//! **combinators over an inner node** (`subgraph` / `feedback` / `oversample` /
//! `resample`) are `subsystem` kinds: their `GraphNode.subgraph` holds a nested graph
//! edited in its own Workbench tab. fundsp's structural plumbing (`Pipe`, `Stack`,
//! `Binop`, `MultiPass`, `An`, `SettingListener`, …) is the net itself, not a node.
//! `snoop` is the metering tap; `Ring` is a real-time queue rather than a DSP node, so
//! it has no kind.

use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter};

mod table;

pub use table::{table_rows, NodeColumn, NodeTable};

mod control;
mod dynamics;
mod filters;
mod filters_cv;
mod generators;
mod math;
mod modulation;
mod reverb;
mod routing;
mod shapers;
mod subsystems;

/// The palette group a node kind belongs to.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ts_rs::TS, EnumIter, Display,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[ts(export)]
pub enum NodeCategory {
    Io,
    Generator,
    Mixer,
    Math,
    Processor,
    #[serde(rename = "filtercv")]
    #[strum(serialize = "filtercv")]
    FilterCv,
    Dynamics,
    Modulation,
    Reverb,
    Control,
    Subsystem,
}

/// One editable numeric parameter of a node kind. The order of a kind's params is
/// the positional order [`super::compile::make_unit`] reads, so it is part of the
/// catalog contract.
#[derive(Debug, Clone, Copy, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NodeParam {
    pub key: &'static str,
    pub label: &'static str,
    pub default: f32,
    pub min: f32,
    pub max: f32,
    pub step: f32,
    pub unit: Option<&'static str>,
}

/// One node kind: the editor's palette entry, the compiler's port table and the DOT
/// parser's param/port vocabulary.
#[derive(Debug, Clone, Copy, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NodeDef {
    pub kind: &'static str,
    pub label: &'static str,
    pub category: NodeCategory,
    /// One name per input, in port order (empty for a generator).
    pub input_ports: &'static [&'static str],
    /// One name per output, in port order (empty for the graph exit).
    pub output_ports: &'static [&'static str],
    pub params: &'static [NodeParam],
    /// Only offered in filter graphs (the signal entry point).
    pub filter_only: bool,
    /// Only offered in synth graphs (sound generators).
    pub synth_only: bool,
    /// A short, plain-language description shown as a tooltip.
    pub hint: &'static str,
    /// The kind wraps an **inner graph** (`GraphNode.subgraph`), edited in its own tab.
    pub subsystem: bool,
    /// A variadic table appended after `params` (see [`NodeTable`]).
    pub table: Option<&'static NodeTable>,
}

/// Shorthand for a parameter spec.
pub const fn param(
    key: &'static str,
    label: &'static str,
    default: f32,
    min: f32,
    max: f32,
    step: f32,
    unit: Option<&'static str>,
) -> NodeParam {
    NodeParam {
        key,
        label,
        default,
        min,
        max,
        step,
        unit,
    }
}

/// A frequency in Hz (0 is a valid DC / sub-audio rate).
pub const fn freq(default: f32) -> NodeParam {
    param("freq", "Freq", default, 0.0, 20_000.0, 1.0, Some("Hz"))
}

/// A pitched oscillator frequency in Hz.
///
/// Unlike [`freq`], the lower bound is a real pitch: `pluck` allocates a period-long
/// line and the DSF oscillators divide by the frequency, so 0 is not a valid pitch.
pub const fn pitch(default: f32) -> NodeParam {
    param("freq", "Freq", default, 10.0, 20_000.0, 1.0, Some("Hz"))
}

/// A filter Q.
pub const fn q() -> NodeParam {
    param("q", "Q", 1.0, 0.01, 100.0, 0.1, None)
}

/// An amplitude gain (`1` is flat; a negative value flips polarity).
///
/// fundsp takes an amplitude, not a dB value, and does not bound it.
pub const fn gain(default: f32) -> NodeParam {
    param("gain", "Gain", default, 0.0, 16.0, 0.05, None)
}

/// A bell / shelf amplitude gain (`1` is flat, below cuts, above boosts).
///
/// fundsp takes the square root of this gain, so it has to stay strictly positive.
pub const fn shelf_gain(default: f32) -> NodeParam {
    param("gain", "Gain", default, 0.001, 16.0, 0.01, None)
}

/// A time constant in seconds with a millisecond step.
pub const fn seconds(
    key: &'static str,
    label: &'static str,
    default: f32,
    min: f32,
    max: f32,
) -> NodeParam {
    param(key, label, default, min, max, 0.001, Some("s"))
}

/// A time constant in seconds with an explicit step.
pub const fn seconds_step(
    key: &'static str,
    label: &'static str,
    default: f32,
    min: f32,
    max: f32,
    step: f32,
) -> NodeParam {
    param(key, label, default, min, max, step, Some("s"))
}

/// A pulse width in 0..1.
pub const fn width() -> NodeParam {
    param("width", "Width", 0.5, 0.01, 0.99, 0.01, None)
}

macro_rules! def {
    ($kind:literal, $label:literal, $cat:ident, [$($ip:literal),*], [$($op:literal),*], [$($param:expr),*], $hint:literal) => {
        NodeDef {
            kind: $kind,
            label: $label,
            category: super::NodeCategory::$cat,
            input_ports: &[$($ip),*],
            output_ports: &[$($op),*],
            params: &[$($param),*],
            filter_only: false,
            synth_only: false,
            hint: $hint,
            subsystem: false,
            table: None,
        }
    };
}

macro_rules! filter_node {
    ($($t:tt)*) => {{
        let mut def = def!($($t)*);
        def.filter_only = true;
        def
    }};
}

macro_rules! synth_node {
    ($($t:tt)*) => {{
        let mut def = def!($($t)*);
        def.synth_only = true;
        def
    }};
}

/// A node that wraps an inner graph (`GraphNode.subgraph`).
macro_rules! subsystem_node {
    ($($t:tt)*) => {{
        let mut def = def!($($t)*);
        def.subsystem = true;
        def
    }};
}

pub(crate) use {def, filter_node, subsystem_node, synth_node};

/// Every node kind, in palette order.
pub fn all() -> &'static [NodeDef] {
    static NODES: std::sync::OnceLock<Vec<NodeDef>> = std::sync::OnceLock::new();
    NODES.get_or_init(|| {
        let mut nodes = Vec::new();
        for group in [
            routing::ROUTING,
            math::MATH,
            filters::FILTERS,
            filters_cv::FILTERS_CV,
            shapers::SHAPERS,
            dynamics::DYNAMICS,
            modulation::MODULATION,
            reverb::REVERB,
            control::CONTROL,
            generators::GENERATORS,
            subsystems::SUBSYSTEMS,
        ] {
            nodes.extend_from_slice(group);
        }
        nodes
    })
}

/// One catalog entry by kind.
pub fn node(kind: &str) -> Option<&'static NodeDef> {
    all().iter().find(|def| def.kind == kind)
}

/// Whether a kind wraps an inner graph, or `false` for an unknown kind.
pub fn is_subsystem(kind: &str) -> bool {
    node(kind).is_some_and(|def| def.subsystem)
}

/// The internal input/output arity of a node kind, or `None` if unknown.
///
/// `input`/`output` are internally pass-throughs (they are anchored to the net's
/// global input/output), which is why they report one input/output here even though
/// the editor shows them with a single visible port.
pub fn kind_arity(kind: &str) -> Option<(usize, usize)> {
    node(kind).map(|def| (def.input_ports.len(), def.output_ports.len()))
}

/// Whether a port name is one of `side`'s names for `def`.
pub fn port_index(def: &NodeDef, side: PortSide, name: &str) -> Option<usize> {
    let ports = match side {
        PortSide::Input => def.input_ports,
        PortSide::Output => def.output_ports,
    };
    ports.iter().position(|port| *port == name)
}

/// Which side of a node a port belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortSide {
    Input,
    Output,
}

/// A ready-to-paste DOT statement for one kind, with its record label and every
/// parameter at its default — what `get_node` reports so an agent never guesses a
/// port or a key. A kind with a variadic table shows it at its default rows.
pub fn dot_skeleton(def: &NodeDef) -> String {
    let table = def.table.map(|table| table.default_rows).unwrap_or(&[]);
    super::dot::node_statement(def.kind, &default_params(def), table, Some(def))
}

/// A kind's parameters at their catalog defaults, keyed by param name.
pub fn default_params(def: &NodeDef) -> Vec<(String, f32)> {
    def.params
        .iter()
        .map(|param| (param.key.to_string(), param.default))
        .collect()
}

/// The catalog as the JSON shape `list_nodes` reports.
pub fn list_json() -> serde_json::Value {
    serde_json::to_value(all()).unwrap_or(serde_json::Value::Null)
}

/// The record-label port order for a multi-port kind: **inputs then outputs**, the order
/// the DOT parser expects in `label="<a> a | …"`. `None` for a single-port kind (which
/// emits no label).
pub fn record_ports(def: &NodeDef) -> Option<Vec<&'static str>> {
    (def.input_ports.len() > 1 || def.output_ports.len() > 1).then(|| {
        def.input_ports
            .iter()
            .chain(def.output_ports.iter())
            .copied()
            .collect()
    })
}

/// The exact `label=` value a multi-port kind's DOT record needs, or `None` when it has
/// at most one port. Sharing this with [`super::dot`] keeps the skeleton and the emitter
/// from disagreeing.
pub fn record_label(def: &NodeDef) -> Option<String> {
    record_ports(def).map(|ports| {
        ports
            .iter()
            .map(|port| format!("<{port}> {port}"))
            .collect::<Vec<_>>()
            .join(" | ")
    })
}

/// One kind's detail as `get_node` reports it: the catalog entry, the record-label
/// contract (`recordPorts` / `labelTemplate`) and the DOT skeleton.
pub fn detail_json(kind: &str) -> Option<serde_json::Value> {
    let def = node(kind)?;
    let mut node = serde_json::to_value(def).ok()?;
    if let serde_json::Value::Object(map) = &mut node {
        // A caller authoring an edge by hand needs the record ports, not just the two
        // per-side lists — the label combines them in input-then-output order.
        map.insert(
            "recordPorts".into(),
            serde_json::to_value(record_ports(def).unwrap_or_default()).ok()?,
        );
        map.insert(
            "labelTemplate".into(),
            serde_json::to_value(record_label(def)).ok()?,
        );
    }
    Some(serde_json::json!({ "node": node, "dot": dot_skeleton(def) }))
}

#[cfg(test)]
mod tests;
