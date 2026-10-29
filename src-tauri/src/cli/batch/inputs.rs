//! Input readers for the batch CLI: the `K=V` param patches, the graph files, and the
//! `--windows` list.
//!
//! Kept apart from [`super::args`] (which maps the matches onto a [`Request`]) so each
//! file stays inside the source-size budget.

use serde_json::Value;

use crate::audio::analyzers;
use crate::audio::graph::{self, GraphSpec};

use super::types::WindowSpec;

/// The shared-param keys `-p` accepts (the same keys MCP's `set_shared_params` takes).
const SHARED_PARAM_KEYS: [&str; 8] = [
    "fftSize",
    "hop",
    "randomizedOverlap",
    "windowFn",
    "channel",
    "resampleTo",
    "freqMinHz",
    "freqMaxHz",
];

/// The values `windowFn` accepts (`docs/analysis-tools.md`).
const WINDOW_FNS: [&str; 4] = ["hann", "hamming", "blackman", "rectangular"];

/// Split a `K=V` token, parsing `V` into a JSON value.
pub(super) fn split_kv(token: &str) -> Result<(String, Value), String> {
    let (key, value) = token
        .split_once('=')
        .ok_or_else(|| format!("expected K=V, got `{token}`"))?;
    if key.is_empty() {
        return Err(format!("empty key in `{token}`"));
    }
    Ok((key.to_string(), parse_value(value)))
}

/// Parse a flag/value string into JSON: `true`/`false` → bool, `none`/`null` → null,
/// an integer → number, a float → number, anything else → string.
fn parse_value(text: &str) -> Value {
    match text {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        "none" | "null" => Value::Null,
        _ => {
            if let Ok(int) = text.parse::<i64>() {
                Value::from(int)
            } else if let Ok(float) = text.parse::<f64>() {
                Value::from(float)
            } else {
                Value::String(text.to_string())
            }
        }
    }
}

pub(super) fn parse_params(tokens: &[String]) -> Result<Vec<(String, Value)>, String> {
    let mut params = Vec::new();
    for token in tokens {
        let (key, value) = split_kv(token)?;
        if !SHARED_PARAM_KEYS.contains(&key.as_str()) {
            return Err(format!("unknown shared param: {key}"));
        }
        validate_param(&key, &value)?;
        params.push((key, value));
    }
    Ok(params)
}

fn validate_param(key: &str, value: &Value) -> Result<(), String> {
    let ok = match key {
        "fftSize" => value.as_u64().is_some(),
        "hop" | "freqMinHz" | "freqMaxHz" => value.as_f64().is_some(),
        "randomizedOverlap" => value.is_boolean(),
        "windowFn" => value
            .as_str()
            .is_some_and(|name| WINDOW_FNS.contains(&name)),
        "channel" | "resampleTo" => value.is_null() || value.as_u64().is_some(),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(format!("bad value for shared param {key}: {value}"))
    }
}

pub(super) fn read_graph(path: &str) -> Result<GraphSpec, String> {
    let text = std::fs::read_to_string(path).map_err(|err| format!("cannot read {path}: {err}"))?;
    serde_json::from_str::<GraphSpec>(&text).map_err(|err| format!("invalid graph {path}: {err}"))
}

/// Read a `--windows` list: one `start,end[,tool…]` per line, `#` comments allowed.
pub(super) fn read_windows(path: &str) -> Result<Vec<WindowSpec>, String> {
    let text = std::fs::read_to_string(path).map_err(|err| format!("cannot read {path}: {err}"))?;
    let mut windows = Vec::new();
    for (index, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line_number = index + 1;
        let fields: Vec<&str> = line.split(',').map(str::trim).collect();
        if fields.len() < 2 {
            return Err(format!(
                "{path}:{line_number}: expected `start,end[,tool…]`, got `{line}`"
            ));
        }
        let start = fields[0]
            .parse::<f64>()
            .map_err(|_| format!("{path}:{line_number}: invalid start `{}`", fields[0]))?;
        let end = fields[1]
            .parse::<f64>()
            .map_err(|_| format!("{path}:{line_number}: invalid end `{}`", fields[1]))?;
        if !start.is_finite() || !end.is_finite() || end <= start {
            return Err(format!(
                "{path}:{line_number}: the window must be finite with end > start ({start}, {end})"
            ));
        }
        let tools: Vec<String> = fields[2..]
            .iter()
            .filter(|name| !name.is_empty())
            .map(|name| (*name).to_string())
            .collect();
        for tool in &tools {
            if !analyzers::is_analyzer(tool) {
                return Err(format!("{path}:{line_number}: unknown analyzer: {tool}"));
            }
        }
        windows.push(WindowSpec { start, end, tools });
    }
    if windows.is_empty() {
        return Err(format!(
            "{path}: no windows (one `start,end[,tool…]` per line)"
        ));
    }
    Ok(windows)
}

/// Read a `--filter` graph and check that it compiles as a filter (one global input).
pub(super) fn read_filter_graph(path: &str) -> Result<GraphSpec, String> {
    let spec = read_graph(path)?;
    if !spec.is_empty() {
        graph::build(&spec, 1, 48_000)
            .map_err(|err| format!("invalid filter graph {path}: {err}"))?;
    }
    Ok(spec)
}

/// Read a `synth` graph and check that it compiles as a synth (no global input).
pub(super) fn read_synth_graph(path: &str) -> Result<GraphSpec, String> {
    let spec = read_graph(path)?;
    graph::build(&spec, 0, 48_000).map_err(|err| format!("invalid synth graph {path}: {err}"))?;
    Ok(spec)
}
