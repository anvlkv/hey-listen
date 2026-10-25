//! The MCP tool catalog.
//!
//! Each tool is named, described, and given a JSON-Schema `inputSchema`. The
//! catalog is **static** (served without a running window, so `tools/list` always
//! answers), and the *implementations* live in the frontend (`src/state/mcp/`),
//! which runs each call against the same stores and commands the UI drives. Keep
//! the two in sync: a name here with no frontend handler returns an error, and a
//! frontend handler with no entry here is invisible to agents.
//!
//! The catalog is split by area — [`observe`] (read-only), [`source`] (source +
//! analysis control), [`workbench`] (tabs, graphs, preview, capture), [`project`]
//! (project files + notes), and [`themes`] — assembled here. [`schema`] holds the
//! shared constructors.

mod observe;
mod project;
mod schema;
mod source;
mod themes;
mod workbench;

#[cfg(test)]
mod tests;

use serde_json::Value;

use schema::add_target_property;

/// The full tool list, in the shape `tools/list` returns.
pub fn list() -> Vec<Value> {
    let mut tools = observe::tools();
    tools.extend(source::tools());
    tools.extend(workbench::tools());
    tools.extend(project::tools());
    tools.extend(themes::tools());

    // Every tool takes an optional `target` (a label from `list_projects`); inject it
    // uniformly rather than repeating it in each schema.
    for entry in &mut tools {
        add_target_property(entry);
    }
    tools
}
