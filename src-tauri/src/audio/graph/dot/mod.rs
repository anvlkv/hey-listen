//! Graphviz DOT as the canonical text form of a [`GraphSpec`] (M39, ADR-36).
//!
//! A node is a statement carrying `kind` plus **keyed** parameters; a node with more
//! than one input or output is a DOT **record** whose `label` names each port
//! (`<audio> audio | <cut> cut | <out> out`). An edge writes `src:out -> dst:cut`.
//!
//! A **subsystem** node writes its nested graph as a `subgraph "<id>.system" { … }`
//! block and names it with `system="<id>.system"` (M40). The block is parsed on its
//! own scope, so its `input`/`output` anchors do not collide with the parent's.
//!
//! Parsing goes through `petgraph`'s `dot_parser` **AST** layer, where the
//! `node:port` reference survives (the higher-level `canonical`/`PetGraph`
//! conversion drops it). `GraphSpec` stays the compiled and stored form; node
//! positions are a GUI-only concern and never cross this boundary.
//!
//! Split into [`emit`] and [`parse`] to stay inside the source-size budget.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use dot_parser::ast::{Graph as DotAst, Stmt};

use super::nodes::{self, NodeDef, PortSide};
use super::{GraphEdge, GraphError, GraphSpec};

mod emit;
mod parse;

pub use emit::emit;
pub(super) use emit::node_statement;
use parse::{edge_chain, parse_node, resolve_endpoint, unquote};

/// Parse a DOT string into a graph spec.
pub fn parse(source: &str) -> Result<GraphSpec, GraphError> {
    let ast = DotAst::<(&str, &str)>::try_from(source)
        .map_err(|err| GraphError::DotSyntax(err.to_string()))?;
    if !ast.is_digraph {
        return Err(GraphError::DotSyntax(
            "expected a directed graph (`digraph { … }`)".to_string(),
        ));
    }
    parse_statements(&ast.stmts.stmts)
}

/// Parse one statement list — the graph body, or a subsystem `subgraph { … }` body.
///
/// A subsystem node carries `system="<name>"` and its inner graph is the top-level
/// `subgraph "<name>" { … }` block. The block is parsed on its own, so its `input` /
/// `output` anchors do not collide with the parent graph's.
fn parse_statements(stmts: &[Stmt<(&str, &str)>]) -> Result<GraphSpec, GraphError> {
    let mut systems: HashMap<String, &dot_parser::ast::Subgraph<(&str, &str)>> = HashMap::new();
    for stmt in stmts {
        if let Stmt::Subgraph(subgraph) = stmt {
            let Some(name) = subgraph.id.as_deref().map(unquote) else {
                return Err(GraphError::DotSyntax(
                    "a subsystem subgraph needs a name".to_string(),
                ));
            };
            if systems.insert(name.clone(), subgraph).is_some() {
                return Err(GraphError::DotSyntax(format!(
                    "the subsystem '{name}' is declared twice"
                )));
            }
        }
    }

    let mut nodes_out = Vec::new();
    let mut defs: HashMap<String, &'static NodeDef> = HashMap::new();
    let mut seen: HashSet<String> = HashSet::new();
    for stmt in stmts {
        match stmt {
            Stmt::NodeStmt(node_stmt) => {
                let (mut node, system) = parse_node(node_stmt)?;
                if !seen.insert(node.id.clone()) {
                    return Err(GraphError::DuplicateNode(node.id));
                }
                if let Some(def) = nodes::node(&node.kind) {
                    defs.insert(node.id.clone(), def);
                }
                if let Some(system) = system {
                    if !nodes::is_subsystem(&node.kind) {
                        return Err(GraphError::UnexpectedSubsystem(node.id));
                    }
                    let block = systems.remove(&system).ok_or_else(|| {
                        GraphError::UnknownSubsystem(format!("{}:{system}", node.id))
                    })?;
                    node.subgraph = Some(Box::new(parse_statements(&block.stmts.stmts)?));
                }
                nodes_out.push(node);
            }
            Stmt::EdgeStmt(_) | Stmt::AttrStmt(_) | Stmt::IDEq(_, _) | Stmt::Subgraph(_) => {}
        }
    }
    // A block no node names is a mistake, not something to silently ignore.
    if let Some((name, _)) = systems.into_iter().next() {
        return Err(GraphError::UnknownSubsystem(name));
    }

    let mut edges_out = Vec::new();
    for stmt in stmts {
        if let Stmt::EdgeStmt(edge_stmt) = stmt {
            for (from, to) in edge_chain(edge_stmt)? {
                let source = resolve_endpoint(&from, PortSide::Output, &defs)?;
                let target = resolve_endpoint(&to, PortSide::Input, &defs)?;
                edges_out.push(GraphEdge {
                    from: source.0,
                    from_port: source.1,
                    to: target.0,
                    to_port: target.1,
                });
            }
        }
    }

    Ok(GraphSpec {
        nodes: nodes_out,
        edges: edges_out,
    })
}

/// Parse a `.dot`/`.gv` file.
pub fn parse_file(path: &str) -> Result<GraphSpec, GraphError> {
    let text = std::fs::read_to_string(path)
        .map_err(|err| GraphError::DotSyntax(format!("cannot read {path}: {err}")))?;
    parse(&text)
}

/// Parse either a DOT string or, when `input` names an existing file, its contents
/// (DOT or a legacy JSON `GraphSpec`). This is the CLI / MCP boundary.
pub fn parse_input(input: &str) -> Result<GraphSpec, GraphError> {
    let path = Path::new(input);
    if path.is_file() {
        let text = std::fs::read_to_string(path)
            .map_err(|err| GraphError::DotSyntax(format!("cannot read {input}: {err}")))?;
        return parse_text(&text);
    }
    if looks_like_dot(input) {
        return parse(input);
    }
    Err(GraphError::DotSyntax(format!(
        "{input} is neither a graph file nor a DOT string"
    )))
}

/// Parse text that is either JSON (legacy) or DOT.
pub fn parse_text(text: &str) -> Result<GraphSpec, GraphError> {
    if text.trim_start().starts_with('{') {
        return serde_json::from_str::<GraphSpec>(text)
            .map_err(|err| GraphError::InvalidGraph(err.to_string()));
    }
    parse(text)
}

/// Whether `text` looks like a DOT graph rather than a path.
///
/// DOT allows comments ahead of the header — `// …` and `/* … */` anywhere, and `#`
/// lines at the start of a file — so a document that opens with a comment still
/// begins with `graph` / `digraph` / `strict` once they are skipped.
pub fn looks_like_dot(text: &str) -> bool {
    let mut rest = text;
    loop {
        rest = rest.trim_start();
        if let Some(after) = rest.strip_prefix("//") {
            rest = after.split_once('\n').map_or("", |(_, tail)| tail);
        } else if let Some(after) = rest.strip_prefix("/*") {
            match after.split_once("*/") {
                Some((_, tail)) => rest = tail,
                None => return false,
            }
        } else if rest.starts_with('#') {
            rest = rest.split_once('\n').map_or("", |(_, tail)| tail);
        } else {
            break;
        }
    }
    let keyword: String = rest.chars().take_while(|c| c.is_alphanumeric()).collect();
    matches!(keyword.as_str(), "digraph" | "graph" | "strict")
}
