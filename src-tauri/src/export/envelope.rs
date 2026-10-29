//! The self-describing JSON export envelope (M12) and the render entry point.
//!
//! `docs/exports.md` defines the shape: `kind`, `formatVersion`, `tool`,
//! `generatedAt`, `source`, `window`, `params`, `options`, and the typed `result`.
//! `window` + `params` + `options` + `tool` are exactly what a template stores, so an
//! exported file and a template fully describe a reproducible analysis.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::audio::analysis::{AnalysisResult, SharedParams};
use crate::project::AnalysisWindow;

use super::{csv::csv, ExportFormat};

/// The envelope's `kind`, so a file is recognizable without its name.
pub const KIND: &str = "hey-listen.analysis";
/// Bump when the envelope shape changes incompatibly.
pub const FORMAT_VERSION: u32 = 1;

/// Where an exported result came from (`docs/source-model.md`): enough to recognize
/// the audio later, including the path for a file source (provenance only).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportSource {
    /// Display name (a file name, or a label such as "Microphone").
    pub name: String,
    /// `file` | `mic` | `system` | `process` | `mix` | `synth`.
    pub kind: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration: f64,
    /// The decoded file's path, when the source is a file.
    #[serde(default)]
    pub path: Option<String>,
}

/// Everything an export says about *how* a result was produced.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportContext {
    pub tool: String,
    pub source: ExportSource,
    pub window: AnalysisWindow,
    pub params: SharedParams,
    /// The tool's **effective** options (defaults overlaid with the values it ran with).
    #[serde(default)]
    pub options: Map<String, Value>,
}

/// A rendered export, before it is written to disk.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RenderedExport {
    /// The suggested file name: `<source stem>.<tool>.<ext>`.
    pub file_name: String,
    /// The file contents (JSON envelope or CSV).
    pub text: String,
    /// CSV only: the provenance JSON for `<name>.meta.json` (the envelope minus `result`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sidecar: Option<String>,
    pub format: ExportFormat,
}

/// Build the provenance envelope around a result.
pub fn envelope(context: &ExportContext, result: &AnalysisResult, generated_at: u64) -> Value {
    let mut value = envelope_without_result(context, generated_at);
    if let (Some(object), Ok(result)) = (value.as_object_mut(), serde_json::to_value(result)) {
        object.insert("result".to_string(), result);
    }
    value
}

/// The envelope without `result` — the CSV sidecar's shape.
fn envelope_without_result(context: &ExportContext, generated_at: u64) -> Value {
    let mut object = Map::new();
    object.insert("kind".to_string(), Value::from(KIND));
    object.insert("formatVersion".to_string(), Value::from(FORMAT_VERSION));
    object.insert("tool".to_string(), Value::from(context.tool.clone()));
    object.insert("generatedAt".to_string(), Value::from(generated_at));
    object.insert(
        "source".to_string(),
        serde_json::to_value(&context.source).unwrap_or(Value::Null),
    );
    object.insert(
        "window".to_string(),
        serde_json::to_value(context.window).unwrap_or(Value::Null),
    );
    object.insert(
        "params".to_string(),
        serde_json::to_value(&context.params).unwrap_or(Value::Null),
    );
    object.insert(
        "options".to_string(),
        Value::Object(context.options.clone()),
    );
    Value::Object(object)
}

/// Render `result` in `format`, with the envelope's timestamp from `generated_at`.
pub fn render(
    context: &ExportContext,
    result: &AnalysisResult,
    format: ExportFormat,
    generated_at: u64,
) -> RenderedExport {
    let file_name = file_name(&context.source.name, &context.tool, format);
    match format {
        ExportFormat::Json => RenderedExport {
            file_name,
            text: pretty(envelope(context, result, generated_at)),
            sidecar: None,
            format,
        },
        ExportFormat::Csv => RenderedExport {
            file_name,
            text: csv(result),
            sidecar: Some(pretty(envelope_without_result(context, generated_at))),
            format,
        },
    }
}

fn pretty(value: Value) -> String {
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

/// The suggested export file name: `<source stem>.<tool>.<ext>`, with characters that
/// are awkward in a path replaced by `_`.
pub fn file_name(source_name: &str, tool: &str, format: ExportFormat) -> String {
    let stem = sanitize(source_stem(source_name));
    format!("{stem}.{}.{}", sanitize(tool), format.extension())
}

/// `mix.wav` → `mix`; a label such as "Microphone" stays as-is.
fn source_stem(name: &str) -> &str {
    let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => stem,
        _ => name,
    }
}

fn sanitize(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "export".to_string()
    } else {
        trimmed
    }
}
