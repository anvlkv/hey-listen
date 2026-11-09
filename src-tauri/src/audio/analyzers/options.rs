//! Per-analyzer engine-option metadata.
//!
//! `list_analyzers` carries the compact keys + defaults; the remaining fields are the
//! full detail M21's `get_analyzer` returns, kept here so the catalog stays the one
//! source of truth. Split out of [`super`] to keep each file small.

use super::AnalyzerId;

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
pub(crate) fn tables() -> impl Iterator<Item = (AnalyzerId, &'static [OptionInfo])> {
    BASE_OPTIONS
        .iter()
        .chain(SPECTRAL_OPTIONS.iter())
        .map(|(id, options)| (*id, *options))
}

/// The engine options declared for `id` (empty for a tool without options).
pub(super) fn options_for(id: AnalyzerId) -> &'static [OptionInfo] {
    tables()
        .find(|(tool, _)| *tool == id)
        .map(|(_, options)| options)
        .unwrap_or(&[])
}

/// The shared loudness-calibration option (M27), built with tool-specific help. `0`
/// means **uncalibrated**, so the values are relative to that tool's own unit; naming
/// the unit here stops an asper, vacil, masking level or dimensionless cue from being
/// described as "relative sones". The model caveats live in the per-tool `about` copy.
const fn calibration(help: &'static str) -> OptionInfo {
    OptionInfo {
        key: "calibrationDbSpl",
        label: "Calibration",
        default: 0.0,
        min: 0.0,
        max: 140.0,
        help,
    }
}

/// `loudness`: sones, relative when uncalibrated.
const CALIBRATION_SONE: OptionInfo =
    calibration("dB SPL of a full-scale sine; 0 = uncalibrated (relative sones).");
/// `specificLoudness`: a sone/Cam density on the ERB-rate axis.
const CALIBRATION_SONE_CAM: OptionInfo = calibration(
    "dB SPL of a full-scale sine; 0 = uncalibrated (relative sone/Cam on the ERB axis).",
);
/// `sharpness`: acum.
const CALIBRATION_ACUM: OptionInfo =
    calibration("dB SPL of a full-scale sine; 0 = uncalibrated (relative acum).");
/// `roughness`: asper.
const CALIBRATION_ASPER: OptionInfo =
    calibration("dB SPL of a full-scale sine; 0 = uncalibrated (relative asper).");
/// `fluctuationStrength`: vacil.
const CALIBRATION_VACIL: OptionInfo =
    calibration("dB SPL of a full-scale sine; 0 = uncalibrated (relative vacil).");
/// `masking`: the threshold is dB SPL while an uncalibrated spectrum is dBFS.
const CALIBRATION_MASKING: OptionInfo = calibration(
    "dB SPL of a full-scale sine; 0 = uncalibrated, so the dBFS spectrum is compared with a dB SPL threshold.",
);
/// `tonality`: a common level shift cancels from the dimensionless ratio.
const CALIBRATION_RATIO: OptionInfo = calibration(
    "dB SPL of a full-scale sine; a common shift cancels from this dimensionless ratio, so 0 = uncalibrated only labels the run.",
);
/// `spatial`: correlation is dimensionless and mid/side stay dBFS.
const CALIBRATION_CUE: OptionInfo = calibration(
    "dB SPL of a full-scale sine; correlation is dimensionless and mid/side stay dBFS, so calibration does not make them SPL.",
);

pub(super) const CALIBRATION_SONE_OPTIONS: &[OptionInfo] = &[CALIBRATION_SONE];
pub(super) const CALIBRATION_SONE_CAM_OPTIONS: &[OptionInfo] = &[CALIBRATION_SONE_CAM];
pub(super) const CALIBRATION_ACUM_OPTIONS: &[OptionInfo] = &[CALIBRATION_ACUM];
pub(super) const CALIBRATION_ASPER_OPTIONS: &[OptionInfo] = &[CALIBRATION_ASPER];
pub(super) const CALIBRATION_VACIL_OPTIONS: &[OptionInfo] = &[CALIBRATION_VACIL];
pub(super) const CALIBRATION_MASKING_OPTIONS: &[OptionInfo] = &[CALIBRATION_MASKING];
pub(super) const CALIBRATION_RATIO_OPTIONS: &[OptionInfo] = &[CALIBRATION_RATIO];
pub(super) const CALIBRATION_CUE_OPTIONS: &[OptionInfo] = &[CALIBRATION_CUE];

/// The unit an option is measured in, derived from its canonical key (`frameMs` →
/// `ms`, `maxF0Hz` → `Hz`, `gateDb` → `dB`). Fractions and counts have no unit.
pub(super) fn option_unit(key: &str) -> Option<&'static str> {
    if key.ends_with("Ms") {
        Some("ms")
    } else if key.ends_with("Hz") {
        Some("Hz")
    } else if key.ends_with("Db") {
        Some("dB")
    } else if key == "calibrationDbSpl" {
        Some("dB SPL")
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
