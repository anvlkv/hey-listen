//! `analyzers` — list the analyzer catalog as JSON or a table.

use std::io::Write;

use serde_json::{json, Value};

use crate::mcp::dispatch::HeadlessSession;

use super::output::emit;

/// List the catalog: JSON array (`--json`) or an `id  section  title` table.
pub(super) fn run_analyzers(
    session: &mut HeadlessSession,
    json: bool,
    out: &mut impl Write,
) -> i32 {
    match session.dispatch("list_analyzers", json!({})) {
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
        Ok(other) => {
            emit(out, &other, false);
            0
        }
        Err(message) => {
            eprintln!("hey-listen: {message}");
            1
        }
    }
}
