//! Per-analyzer engine-option metadata.
//!
//! `list_analyzers` carries the compact keys + defaults; the remaining fields are the
//! full detail M21's `get_analyzer` returns, kept here so the catalog stays the one
//! source of truth. Split out of [`super`] to keep each file small.

/// One per-tool **engine** option's metadata.
pub struct OptionInfo {
    /// Canonical camelCase key (matching `ToolOptions`).
    pub key: &'static str,
    pub label: &'static str,
    pub default: f64,
    pub min: f64,
    pub max: f64,
    pub help: &'static str,
}

mod spectral;
mod table;

pub(crate) use spectral::OPTIONS as SPECTRAL_OPTIONS;
pub(crate) use table::OPTIONS as BASE_OPTIONS;

/// Every table, so validation and tests can iterate all declared options.
pub(crate) fn tables() -> impl Iterator<Item = &'static (&'static str, &'static [OptionInfo])> {
    BASE_OPTIONS.iter().chain(SPECTRAL_OPTIONS.iter())
}

/// The engine options declared for `id` (empty for a tool without options).
pub(super) fn options_for(id: &str) -> &'static [OptionInfo] {
    tables()
        .find(|(tool, _)| *tool == id)
        .map(|(_, options)| *options)
        .unwrap_or(&[])
}

/// The unit an option is measured in, derived from its canonical key (`frameMs` →
/// `ms`, `maxF0Hz` → `Hz`, `gateDb` → `dB`). Fractions and counts have no unit.
pub(super) fn option_unit(key: &str) -> Option<&'static str> {
    if key.ends_with("Ms") {
        Some("ms")
    } else if key.ends_with("Hz") {
        Some("Hz")
    } else if key.ends_with("Db") {
        Some("dB")
    } else if key == "minVoicedSecs" {
        Some("s")
    } else {
        None
    }
}

/// A sensible UI step for an option, matched to its scale.
pub(super) fn option_step(key: &str) -> f64 {
    match key {
        "rolloffPercent" | "yinThreshold" => 0.01,
        "minVoicedSecs" => 0.05,
        "modMinHz" | "modMaxHz" => 0.5,
        _ => 1.0,
    }
}

/// One option's full metadata, the shape `get_analyzer` reports.
pub(super) fn option_meta(option: &OptionInfo) -> serde_json::Value {
    serde_json::json!({
        "key": option.key,
        "label": option.label,
        "default": option.default,
        "min": option.min,
        "max": option.max,
        "step": option_step(option.key),
        "unit": option_unit(option.key),
        "help": option.help,
    })
}
