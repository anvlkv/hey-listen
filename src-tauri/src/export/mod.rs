//! Analysis exports (M12): the self-describing **provenance envelope** (JSON) and
//! the **wide-matrix CSV** renderer, shared by the app, the MCP server, and the batch
//! CLI so every surface writes byte-identical data. See `docs/exports.md`.
//!
//! The envelope wraps the typed [`AnalysisResult`] with everything needed to
//! reproduce it (source, window, shared params, per-tool options), while CSV is data
//! only — its provenance travels in an optional `.meta.json` sidecar (the envelope
//! without `result`). Chart PNG capture is a frontend concern: it reads the rendered
//! canvas and writes bytes through `commands/export.rs`.

mod csv;
mod envelope;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

pub use envelope::{render, ExportContext, ExportSource, RenderedExport};

/// The data formats an analysis can be exported as.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ExportFormat {
    /// The provenance envelope around the typed result.
    #[default]
    Json,
    /// Data only, one row per time frame (or per readout/note).
    Csv,
}

impl ExportFormat {
    /// The file extension (without the dot).
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Json => "json",
            ExportFormat::Csv => "csv",
        }
    }

    /// The lowercase name the IPC / MCP / CLI surfaces use.
    pub fn as_str(self) -> &'static str {
        self.extension()
    }
}
