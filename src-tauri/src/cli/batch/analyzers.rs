//! `analyzers [ID]` — list the analyzer catalog, or explain one analyzer.

use std::io::Write;

use serde_json::{json, Value};

use crate::mcp::dispatch::HeadlessSession;

use super::output::emit;

/// List the catalog (`id  section  title`) or explain one analyzer's description,
/// options, and summary keys. `--json` mirrors MCP's `list_analyzers`/`get_analyzer`.
pub(super) fn run_analyzers(
    session: &mut HeadlessSession,
    id: Option<&str>,
    json: bool,
    out: &mut impl Write,
) -> i32 {
    let (tool, args) = match id {
        Some(id) => ("get_analyzer", json!({ "id": id })),
        None => ("list_analyzers", json!({})),
    };
    match session.dispatch(tool, args) {
        Ok(Value::Array(items)) => {
            if json {
                emit(out, &Value::Array(items), false);
            } else {
                for item in items {
                    let _ = writeln!(
                        out,
                        "{}\t{}\t{}",
                        item["id"].as_str().unwrap_or(""),
                        item["section"].as_str().unwrap_or(""),
                        item["title"].as_str().unwrap_or(""),
                    );
                }
            }
            0
        }
        Ok(detail) => {
            if json {
                emit(out, &detail, false);
            } else {
                let _ = write_detail(out, &detail);
            }
            0
        }
        Err(message) => {
            eprintln!("hey-listen: {message}");
            1
        }
    }
}

/// The human-readable form of one analyzer's `get_analyzer` detail.
fn write_detail(out: &mut impl Write, detail: &Value) -> std::io::Result<()> {
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
