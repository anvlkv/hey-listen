//! The **variadic table** a node kind may carry (`NodeTable`): the rows fundsp takes as
//! a list rather than as fixed catalog params, plus the helper that reads one off a node.

use serde::Serialize;

use super::super::GraphNode;

/// One column of a [`NodeTable`], with the range its values must stay inside.
#[derive(Debug, Clone, Copy, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NodeColumn {
    pub label: &'static str,
    pub min: f32,
    pub max: f32,
    pub step: f32,
}

/// A **variadic** row-major table appended after a kind's named `params`.
///
/// A table holds values fundsp takes as a *list*, not as fixed catalog params — the
/// partials of a wavetable, or the notes of a sequence: however many the caller asks
/// for. A kind with a table stores its rows after the named params, in row order, and
/// DOT carries them in one packed attribute. The frontend edits them in the node's own
/// table tab (`table:<parent>/<node>`).
#[derive(Debug, Clone, Copy, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NodeTable {
    /// The DOT attribute that carries the rows, e.g. `harmonics="1,0,0.5,0"`.
    pub key: &'static str,
    pub label: &'static str,
    /// One column per value in a row, in row order (each with its own range).
    pub columns: &'static [NodeColumn],
    /// The most rows the table may hold (a cap on DOT size and build cost).
    pub max_rows: usize,
    /// The rows a node with no serialized table starts from (row-major).
    pub default_rows: &'static [f32],
}

/// A node's variadic-table rows: its params past the named ones, or the catalog's
/// default rows when it stores none of its own (a hand-written DOT statement still has
/// to sound).
pub fn table_rows<'a>(graph: &'a GraphNode, kind: &str) -> &'a [f32] {
    let def = super::node(kind);
    let named = def.map_or(1, |def| def.params.len());
    let tail = graph.params.get(named..).unwrap_or(&[]);
    if !tail.is_empty() {
        return tail;
    }
    def.and_then(|def| def.table)
        .map_or(&[], |table| table.default_rows)
}
