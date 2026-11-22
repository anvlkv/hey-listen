//! DOT **parsing** helpers: node statements, record labels, edge endpoints.
//! [`super`] assembles the spec; [`super::emit`] writes it back.

use std::collections::HashMap;

use dot_parser::ast::either::Either;
use dot_parser::ast::{EdgeStmt, NodeID, NodeStmt, Port};

use super::super::nodes::{self, port_index, NodeDef, PortSide};
use super::super::{GraphError, GraphNode};

pub(super) fn parse_node(
    stmt: &NodeStmt<(&str, &str)>,
) -> Result<(GraphNode, Option<String>), GraphError> {
    let id = unquote(&stmt.node.id);
    let attrs = flatten(stmt);
    let kind = attrs
        .iter()
        .find(|(key, _)| *key == "kind")
        .map(|(_, value)| unquote(value))
        .ok_or_else(|| GraphError::MissingKind(id.clone()))?;
    let def = nodes::node(&kind).ok_or_else(|| GraphError::UnknownKind(kind.clone()))?;

    let mut values: HashMap<&str, f32> = HashMap::new();
    let mut rows: Vec<f32> = Vec::new();
    let mut system: Option<String> = None;
    for (key, raw) in &attrs {
        if *key == "kind" {
            continue;
        }
        if *key == "label" {
            validate_label(&id, def, raw)?;
            continue;
        }
        if *key == "system" {
            system = Some(unquote(raw));
            continue;
        }
        // A variadic table arrives as one packed attribute (`harmonics="1,0,…"`).
        if let Some(table) = def.table {
            if *key == table.key {
                rows = parse_table(&id, table, raw)?;
                continue;
            }
        }
        let param = def
            .params
            .iter()
            .find(|param| param.key == *key)
            .ok_or_else(|| GraphError::UnknownParam(format!("{}.{}", def.kind, key)))?;
        let value: f32 = raw.parse().map_err(|_| {
            GraphError::BadParamValue(format!("{}.{}={}", def.kind, param.key, raw))
        })?;
        if !value.is_finite() || value < param.min || value > param.max {
            return Err(GraphError::ParamOutOfRange(format!(
                "{}.{}={} (allowed {}..{})",
                def.kind, param.key, raw, param.min, param.max
            )));
        }
        values.insert(param.key, value);
    }

    if (def.input_ports.len() > 1 || def.output_ports.len() > 1)
        && !attrs.iter().any(|(key, _)| *key == "label")
    {
        return Err(GraphError::MissingLabel(id));
    }

    Ok((
        GraphNode {
            id,
            kind,
            params: def
                .params
                .iter()
                .map(|param| values.get(param.key).copied().unwrap_or(param.default))
                .chain(rows)
                .collect(),
            subgraph: None,
        },
        system,
    ))
}

/// Split a packed table attribute into whole rows, validating each value against its
/// **own column's** range and the table's row cap.
fn parse_table(node: &str, table: &nodes::NodeTable, raw: &str) -> Result<Vec<f32>, GraphError> {
    let width = table.columns.len().max(1);
    let text = unquote(raw);
    let mut rows: Vec<f32> = Vec::new();
    for token in text
        .split(',')
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        let value: f32 = token
            .parse()
            .map_err(|_| GraphError::BadParamValue(format!("{node}: {}", table.key)))?;
        rows.push(value);
    }
    if !rows.len().is_multiple_of(width) {
        return Err(GraphError::BadParamValue(format!(
            "{node}: {} needs {} values per row",
            table.key, width
        )));
    }
    if rows.len() / width > table.max_rows {
        return Err(GraphError::BadParamValue(format!(
            "{node}: {} may hold at most {} rows",
            table.key, table.max_rows
        )));
    }
    for (index, value) in rows.iter().enumerate() {
        let column = &table.columns[index % width];
        if !value.is_finite() || *value < column.min || *value > column.max {
            return Err(GraphError::ParamOutOfRange(format!(
                "{node}: {} row {} {}={} (allowed {}..{})",
                table.key,
                index / width + 1,
                column.label,
                value,
                column.min,
                column.max
            )));
        }
    }
    Ok(rows)
}

/// A record label lists exactly the catalog's ports, in order.
fn validate_label(node: &str, def: &NodeDef, raw: &str) -> Result<(), GraphError> {
    let expected: Vec<&str> = def
        .input_ports
        .iter()
        .chain(def.output_ports.iter())
        .copied()
        .collect();
    let mut found = Vec::new();
    for field in raw.split('|') {
        let field = field.trim();
        let Some(open) = field.find('<') else {
            continue;
        };
        let Some(close) = field[open..].find('>') else {
            return Err(GraphError::BadLabel(format!("{node}: {raw}")));
        };
        found.push(field[open + 1..open + close].trim());
    }
    if found == expected {
        Ok(())
    } else {
        Err(GraphError::BadLabel(format!(
            "{node}: expected ports {:?}, got {:?}",
            expected, found
        )))
    }
}

fn flatten<'a>(stmt: &'a NodeStmt<(&'a str, &'a str)>) -> Vec<(&'a str, &'a str)> {
    stmt.attr
        .as_ref()
        .map(|list| {
            list.elems
                .iter()
                .flat_map(|alist| alist.elems.iter().copied())
                .collect()
        })
        .unwrap_or_default()
}

/// Expand one edge statement (including `a -> b -> c` chains) into pairs.
pub(super) fn edge_chain(
    stmt: &EdgeStmt<(&str, &str)>,
) -> Result<Vec<(NodeID, NodeID)>, GraphError> {
    let from = match &stmt.from {
        Either::Left(node) => node.clone(),
        Either::Right(_) => {
            return Err(GraphError::DotSyntax(
                "a subgraph cannot be the source of an edge".to_string(),
            ));
        }
    };
    let mut pairs = Vec::new();
    let mut previous = from;
    let mut next = Some(&stmt.next);
    while let Some(rhs) = next {
        let to = match &rhs.to {
            Either::Left(node) => node.clone(),
            Either::Right(_) => {
                return Err(GraphError::DotSyntax(
                    "a subgraph cannot be the target of an edge".to_string(),
                ));
            }
        };
        pairs.push((previous.clone(), to.clone()));
        previous = to;
        next = rhs.next.as_deref();
    }
    Ok(pairs)
}

/// Resolve `node[:port]` to the node id and its port index.
pub(super) fn resolve_endpoint(
    id: &NodeID,
    side: PortSide,
    defs: &HashMap<String, &'static NodeDef>,
) -> Result<(String, usize), GraphError> {
    let name = unquote(&id.id);
    let def = defs
        .get(&name)
        .ok_or_else(|| GraphError::UnknownNode(name.clone()))?;
    let ports = match side {
        PortSide::Input => def.input_ports,
        PortSide::Output => def.output_ports,
    };
    let index = match &id.port {
        Some(Port::ID(port, _)) => {
            let port = unquote(port);
            port_index(def, side, &port)
                .ok_or_else(|| GraphError::UnknownPort(format!("{name}:{port}")))?
        }
        Some(Port::Compass(_)) => {
            return Err(GraphError::BadEdge(format!("{name}: compass port")));
        }
        None if ports.len() > 1 => return Err(GraphError::MissingPort(name)),
        None => 0,
    };
    if index >= ports.len() {
        return Err(GraphError::UnknownPort(name));
    }
    Ok((name, index))
}

/// Strip DOT quoting from an identifier or attribute value.
pub(super) fn unquote(text: &str) -> String {
    let text = text.trim();
    if text.len() >= 2 && text.starts_with('"') && text.ends_with('"') {
        return text[1..text.len() - 1]
            .replace("\\\"", "\"")
            .replace("\\\\", "\\");
    }
    if text.len() >= 2 && text.starts_with('<') && text.ends_with('>') {
        return text[1..text.len() - 1].to_string();
    }
    text.to_string()
}
