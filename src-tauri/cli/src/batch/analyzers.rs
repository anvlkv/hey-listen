//! `analyzers [ID]` — list the analyzer catalog, or explain one analyzer.

use std::io::Write;

use serde_json::Value;

use hey_listen_lib::mcp::dispatch::HeadlessSession;

use super::catalog::{run_catalog, CatalogFormat, CatalogTools};

/// List the catalog (`id  section  title`) or explain one analyzer's description,
/// options, and summary keys. `--json` mirrors MCP's `list_analyzers`/`get_analyzer`.
pub(super) fn run_analyzers(
    session: &mut HeadlessSession,
    id: Option<&str>,
    json: bool,
    out: &mut impl Write,
) -> i32 {
    run_catalog(
        session,
        CatalogTools {
            list: "list_analyzers",
            detail: "get_analyzer",
            id_key: "id",
        },
        id,
        json,
        out,
        CatalogFormat {
            row,
            detail: write_detail,
        },
    )
}

fn row(item: &Value) -> String {
    format!(
        "{}\t{}\t{}",
        item["id"].as_str().unwrap_or(""),
        item["section"].as_str().unwrap_or(""),
        item["title"].as_str().unwrap_or(""),
    )
}

/// The human-readable form of one analyzer's `get_analyzer` detail.
fn write_detail(out: &mut dyn Write, detail: &Value) -> std::io::Result<()> {
    let text = |key: &str| detail[key].as_str().unwrap_or("");
    writeln!(
        out,
        "{} — {} ({})",
        text("id"),
        text("title"),
        text("section")
    )?;
    writeln!(out, "  {}", text("description"))?;
    let about = text("about");
    if !about.is_empty() && about != text("description") {
        writeln!(out, "  {about}")?;
    }
    let keywords: Vec<&str> = detail["keywords"]
        .as_array()
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if !keywords.is_empty() {
        writeln!(out, "  Keywords: {}", keywords.join(", "))?;
    }
    if let Some(options) = detail["options"]
        .as_array()
        .filter(|items| !items.is_empty())
    {
        writeln!(out, "  Options:")?;
        for option in options {
            let number = |key: &str| option[key].as_f64().unwrap_or(0.0);
            let unit = option["unit"].as_str().unwrap_or("");
            let default = if unit.is_empty() {
                format!("{}", number("default"))
            } else {
                format!("{} {unit}", number("default"))
            };
            writeln!(
                out,
                "    {:<16} {:<18} default {default}  ({}…{}, step {})",
                option["key"].as_str().unwrap_or(""),
                option["label"].as_str().unwrap_or(""),
                number("min"),
                number("max"),
                number("step"),
            )?;
            let help = option["help"].as_str().unwrap_or("");
            if !help.is_empty() {
                writeln!(out, "      {help}")?;
            }
        }
    }
    let keys: Vec<&str> = detail["summaryKeys"]
        .as_array()
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if !keys.is_empty() {
        writeln!(out, "  Summary keys: {}", keys.join(", "))?;
    }
    Ok(())
}
