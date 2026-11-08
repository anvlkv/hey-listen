//! The `tauri-plugin-cli` matches → value parsing helpers (kept apart from the request
//! mapping in [`super`] for the source-size budget).

use serde_json::Value;
use tauri_plugin_cli::Matches;

use crate::audio::analysis::canonical_option_key;
use crate::audio::analyzers::{AnalyzerId, ToolId};

use super::super::inputs::split_kv;
use super::super::types::OptionPatch;

// --- parsing helpers -----------------------------------------------------

pub(super) fn strings(matches: &Matches, name: &str) -> Vec<String> {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(in crate::cli::batch) fn string(matches: &Matches, name: &str) -> Option<String> {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_str())
        .map(str::to_string)
}

/// A repeatable Workbench tool id (`--open-tool`), parsed once here.
pub(super) fn tool_ids(matches: &Matches, name: &str) -> Result<Vec<ToolId>, String> {
    strings(matches, name)
        .into_iter()
        .map(|id| {
            id.parse::<ToolId>()
                .map_err(|_| format!("unknown tool in --{name}: {id}"))
        })
        .collect()
}

pub(in crate::cli::batch) fn flag(matches: &Matches, name: &str) -> bool {
    matches
        .args
        .get(name)
        .and_then(|arg| arg.value.as_bool())
        .unwrap_or(false)
}

pub(super) fn optional_number(matches: &Matches, name: &str) -> Result<Option<f64>, String> {
    match string(matches, name) {
        Some(text) => text
            .parse::<f64>()
            .map(Some)
            .map_err(|_| format!("invalid --{name}: {text}")),
        None => Ok(None),
    }
}

/// Parse `-t` ids. A spelling that is not an analyzer id is **kept** for the run phase,
/// which reports it as one `error` record and exits `1` (the documented CLI contract),
/// instead of failing the whole invocation as a usage error. The other option, a bare
/// `KEY=VALUE` (`-o K=V`), is scoped to the sole `--tool` (there is no other way to tell
/// which tool it belongs to, since the plugin's matches do not preserve flag order).
pub(super) fn request_tools(matches: &Matches) -> (Vec<AnalyzerId>, Vec<String>) {
    let mut known = Vec::new();
    let mut unknown = Vec::new();
    for tool in strings(matches, "tool") {
        match tool.parse::<AnalyzerId>() {
            Ok(id) => known.push(id),
            Err(_) => unknown.push(tool),
        }
    }
    (known, unknown)
}

pub(super) fn parse_option_patches(
    tokens: &[String],
    tools: &[AnalyzerId],
) -> Result<Vec<OptionPatch>, String> {
    let mut patches = Vec::new();
    for token in tokens {
        let (lhs, value) = split_kv(token)?;
        let (tool, key) = match lhs.split_once('.') {
            Some((tool, key)) => (
                tool.parse::<AnalyzerId>()
                    .map_err(|_| format!("unknown analyzer in `-o`: {tool}"))?,
                key.to_string(),
            ),
            None if tools.len() == 1 => (tools[0], lhs),
            None => {
                return Err(format!(
                    "`-o {token}` must name its tool: use `-o <TOOL>.<KEY>=<VALUE>`"
                ))
            }
        };
        // Canonicalize camelCase / snake_case (`min_f0_hz` → `minF0Hz`) so the same
        // keys MCP's `set_tool_options` takes work here too.
        let key = canonical_option_key(&key)
            .ok_or_else(|| format!("unknown option for {tool}: {key}"))?;
        patches.push(OptionPatch {
            tool,
            key: key.to_string(),
            value,
        });
    }
    Ok(patches)
}
