//! `nodes [KIND]` — list the filter/synth node catalog, or explain one kind.
//!
//! Mirrors MCP's `list_nodes` / `get_node` (M39, ADR-36), including the ready-to-paste
//! DOT skeleton.

use std::io::Write;

use serde_json::Value;

use hey_listen_lib::mcp::dispatch::HeadlessSession;

use super::catalog::{run_catalog, CatalogFormat, CatalogTools};

pub(super) fn run_nodes(
    session: &mut HeadlessSession,
    id: Option<&str>,
    json: bool,
    out: &mut impl Write,
) -> i32 {
    run_catalog(
        session,
        CatalogTools {
            list: "list_nodes",
            detail: "get_node",
            id_key: "kind",
        },
        id,
        json,
        out,
        CatalogFormat {
            row,
            detail: write_node_detail,
        },
    )
}

fn row(item: &Value) -> String {
    format!(
        "{}\t{}\t{}→{}\t{}",
        item["kind"].as_str().unwrap_or(""),
        item["category"].as_str().unwrap_or(""),
        item["inputPorts"].as_array().map_or(0, Vec::len),
        item["outputPorts"].as_array().map_or(0, Vec::len),
        item["label"].as_str().unwrap_or(""),
    )
}

fn write_node_detail(out: &mut dyn Write, detail: &Value) -> std::io::Result<()> {
    let node = &detail["node"];
    let text = |key: &str| node[key].as_str().unwrap_or("");
    writeln!(
        out,
        "{} — {} ({})",
        text("kind"),
        text("label"),
        text("category")
    )?;
    writeln!(out, "  {}", text("hint"))?;
    writeln!(out, "  Inputs:  {}", ports(&node["inputPorts"]))?;
    writeln!(out, "  Outputs: {}", ports(&node["outputPorts"]))?;
    if let Some(params) = node["params"].as_array().filter(|items| !items.is_empty()) {
        writeln!(out, "  Params:")?;
        for param in params {
            let number = |key: &str| param[key].as_f64().unwrap_or(0.0);
            let unit = param["unit"].as_str().unwrap_or("");
            let default = if unit.is_empty() {
                format!("{}", number("default"))
            } else {
                format!("{} {unit}", number("default"))
            };
            writeln!(
                out,
                "    {:<16} {:<14} default {default}  ({}…{}, step {})",
                param["key"].as_str().unwrap_or(""),
                param["label"].as_str().unwrap_or(""),
                number("min"),
                number("max"),
                number("step"),
            )?;
        }
    }
    writeln!(out, "  DOT:")?;
    for line in detail["dot"].as_str().unwrap_or("").lines() {
        writeln!(out, "    {line}")?;
    }
    Ok(())
}

fn ports(value: &Value) -> String {
    let names: Vec<&str> = value
        .as_array()
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if names.is_empty() {
        "—".to_string()
    } else {
        names.join(", ")
    }
}
