//! Canonical result summaries (M21).
//!
//! Every analyzer result gets a [`ResultSummary`]: a stable one-line `text` plus the
//! labelled, unit-bearing `items` it is built from. The summary is computed from the
//! **full** result before any compaction, so it is identical in the summary, compact,
//! and full output modes, and the GUI, the headless MCP server, and the CLI all speak
//! it. See `docs/mcp-cli-ergonomics.md`.

mod families;
mod format;
mod keys;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

use super::AnalysisResult;

pub use keys::summary_keys;

/// One number in a summary: a stable key, a human label, the value, and its unit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SummaryItem {
    /// Stable machine key, e.g. `peakHz`.
    pub key: String,
    /// Human label, e.g. `peak frequency`.
    pub label: String,
    pub value: f64,
    /// `"Hz"`, `"dBFS"`, `"s"`, `"%"`, … — absent for a plain count.
    pub unit: Option<String>,
}

/// A tool's result summary: the human line plus its machine-readable items.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ResultSummary {
    /// The analyzer id that produced the result.
    pub tool: String,
    /// Human label (`"Spectrum"`).
    pub label: String,
    /// One compact human-readable line, e.g. `peak 440 Hz · −6 dBFS · 43 frames`.
    pub text: String,
    pub items: Vec<SummaryItem>,
}

/// Accumulates a tool's items, then renders the `text` line from them.
pub(super) struct SummaryBuilder {
    tool: &'static str,
    label: &'static str,
    items: Vec<SummaryItem>,
}

impl SummaryBuilder {
    pub(super) fn new(tool: &'static str, label: &'static str) -> Self {
        Self {
            tool,
            label,
            items: Vec::new(),
        }
    }

    /// Add a numeric item. A non-finite value is dropped rather than serialized as
    /// `null`, so every item an agent reads is a real number.
    pub(super) fn push(
        &mut self,
        key: &'static str,
        label: &'static str,
        value: f64,
        unit: Option<&'static str>,
    ) {
        if !value.is_finite() {
            return;
        }
        self.items.push(SummaryItem {
            key: key.to_string(),
            label: label.to_string(),
            value,
            unit: unit.map(str::to_string),
        });
    }

    /// Add an integer count (no unit).
    pub(super) fn count(&mut self, key: &'static str, label: &'static str, value: usize) {
        self.push(key, label, value as f64, None);
    }

    pub(super) fn finish(self) -> ResultSummary {
        let text = self
            .items
            .iter()
            .map(|item| {
                let value = format::format_value(item.value, item.unit.as_deref());
                format!("{} {value}", item.label)
            })
            .collect::<Vec<_>>()
            .join(" · ");
        ResultSummary {
            tool: self.tool.to_string(),
            label: self.label.to_string(),
            text,
            items: self.items,
        }
    }
}

/// The canonical summary for a full analysis result.
pub fn summarize(result: &AnalysisResult) -> ResultSummary {
    families::summarize(result)
}
