//! DOT **emission**: a [`GraphSpec`](super::GraphSpec) as text, nested subsystems
//! included. The parser lives in [`super::parse`].

use super::super::nodes::{self, NodeDef, PortSide};
use super::super::{GraphError, GraphNode, GraphSpec};

/// Emit a graph spec as DOT. `GraphSpec → DOT → GraphSpec` is identity.
pub fn emit(spec: &GraphSpec) -> Result<String, GraphError> {
    let mut out = String::from("digraph {\n    node [shape=record];\n");
    emit_statements(spec, "    ", &mut out)?;
    out.push_str("}\n");
    Ok(out)
}

/// Emit one graph body at `indent`. A subsystem node names its nested block
/// (`system="id.system"`), which is written right after the node statement.
fn emit_statements(spec: &GraphSpec, indent: &str, out: &mut String) -> Result<(), GraphError> {
    for node in &spec.nodes {
        let def =
            nodes::node(&node.kind).ok_or_else(|| GraphError::UnknownKind(node.kind.clone()))?;
        let params: Vec<(String, f32)> = def
            .params
            .iter()
            .enumerate()
            .map(|(index, param)| {
                (
                    param.key.to_string(),
                    node.params.get(index).copied().unwrap_or(param.default),
                )
            })
            .collect();
        let table = table_rows(node, def);
        let system = node
            .subgraph
            .as_ref()
            .map(|_| format!("{}.system", node.id));
        out.push_str(indent);
        out.push_str(&node_statement_full(
            &node.id,
            &params,
            &table,
            Some(def),
            system.as_deref(),
        ));
        out.push('\n');
        if let Some(subgraph) = &node.subgraph {
            let name = system.as_deref().unwrap_or_default();
            out.push_str(&format!("{indent}subgraph \"{}\" {{\n", escape(name)));
            emit_statements(subgraph, &format!("{indent}    "), out)?;
            out.push_str(&format!("{indent}}}\n"));
        }
    }
    for edge in &spec.edges {
        let from = nodes::node(
            spec.nodes
                .iter()
                .find(|node| node.id == edge.from)
                .map(|node| node.kind.as_str())
                .unwrap_or_default(),
        );
        let to = nodes::node(
            spec.nodes
                .iter()
                .find(|node| node.id == edge.to)
                .map(|node| node.kind.as_str())
                .unwrap_or_default(),
        );
        out.push_str(&format!(
            "{indent}{} -> {};\n",
            endpoint(&edge.from, from, PortSide::Output, edge.from_port),
            endpoint(&edge.to, to, PortSide::Input, edge.to_port),
        ));
    }
    Ok(())
}

/// One node statement, used both by [`emit`] and by `get_node`'s DOT skeleton.
pub fn node_statement(
    id: &str,
    params: &[(String, f32)],
    table: &[f32],
    def: Option<&NodeDef>,
) -> String {
    node_statement_full(id, params, table, def, None)
}

/// The rows of a node's variadic table (the params past its named ones), cut to whole
/// rows and the catalog's row cap.
fn table_rows(node: &GraphNode, def: &NodeDef) -> Vec<f32> {
    let Some(table) = def.table else {
        return Vec::new();
    };
    let width = table.columns.len().max(1);
    let mut rows: Vec<f32> = node.params.iter().skip(def.params.len()).copied().collect();
    let whole = rows.len().min(table.max_rows * width) / width * width;
    rows.truncate(whole);
    rows
}

/// A node statement, optionally naming the node's subsystem block.
fn node_statement_full(
    id: &str,
    params: &[(String, f32)],
    table: &[f32],
    def: Option<&NodeDef>,
    system: Option<&str>,
) -> String {
    let kind = def.map(|def| def.kind).unwrap_or_default();
    let mut attrs = vec![format!("kind=\"{kind}\"")];
    for (key, value) in params {
        attrs.push(format!("{key}={}", number(*value)));
    }
    // A variadic table travels as **one** packed attribute, so the row count is free.
    if let (Some(table_def), false) = (def.and_then(|def| def.table), table.is_empty()) {
        let rows: Vec<String> = table.iter().map(|value| number(*value)).collect();
        attrs.push(format!("{}=\"{}\"", table_def.key, rows.join(",")));
    }
    if let Some(system) = system {
        attrs.push(format!("system=\"{}\"", escape(system)));
    }
    if let Some(def) = def {
        if let Some(label) = nodes::record_label(def) {
            attrs.push(format!("label=\"{label}\""));
        }
    }
    format!("{} [{}];", dot_id(id), attrs.join(", "))
}

/// Escape a DOT quoted string.
fn escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

/// `node:port` on a side that shows ports, `node` otherwise.
fn endpoint(node: &str, def: Option<&NodeDef>, side: PortSide, port: usize) -> String {
    let Some(def) = def else {
        return if port == 0 {
            dot_id(node)
        } else {
            format!("{}:{port}", dot_id(node))
        };
    };
    let ports = match side {
        PortSide::Input => def.input_ports,
        PortSide::Output => def.output_ports,
    };
    let name = ports.get(port).copied().unwrap_or_default();
    if ports.len() > 1 {
        format!("{}:{name}", dot_id(node))
    } else {
        dot_id(node)
    }
}

/// A DOT id, quoted unless it is a plain identifier.
fn dot_id(id: &str) -> String {
    let bare = id.chars().enumerate().all(|(index, ch)| {
        if index == 0 {
            ch.is_ascii_alphabetic() || ch == '_'
        } else {
            ch.is_ascii_alphanumeric() || ch == '_'
        }
    }) && !matches!(
        id,
        "node" | "edge" | "graph" | "digraph" | "subgraph" | "strict"
    );
    if bare {
        id.to_string()
    } else {
        format!("\"{}\"", id.replace('\\', "\\\\").replace('"', "\\\""))
    }
}

fn number(value: f32) -> String {
    if value.is_nan() {
        return "0".to_string();
    }
    format!("{value}")
}
