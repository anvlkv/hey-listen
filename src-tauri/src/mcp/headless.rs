//! The headless stdio MCP server (no window, no TCP).
//!
//! Reads newline-delimited JSON-RPC from stdin and writes responses to stdout — the
//! framing MCP uses over stdio — dispatching each `tools/call` through
//! [`HeadlessSession`]. Used when no running, MCP-enabled app is advertising itself
//! (or when `--headless` forces it). See [`super::run`].

use std::io::{BufRead, BufReader, Write};

use serde_json::Value;

use super::dispatch::HeadlessSession;
use super::protocol;

/// Run the headless server until stdin closes.
pub fn run() -> std::io::Result<()> {
    let mut session = HeadlessSession::default();

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();

    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break; // the client closed the session
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut dispatch = |tool: &str, arguments: Value| session.dispatch(tool, arguments);
        if let Some(response) = protocol::handle_message(trimmed, &mut dispatch) {
            let mut bytes = serde_json::to_vec(&response)?;
            bytes.push(b'\n');
            writer.write_all(&bytes)?;
            writer.flush()?;
        }
    }
    Ok(())
}
