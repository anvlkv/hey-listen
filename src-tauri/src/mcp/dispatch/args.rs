//! Argument and shared-params helpers for the headless dispatch table.
//!
//! [`default_params`] seeds the session; [`merge_params`] / [`merge_options`] apply
//! the camelCase patch objects an agent sends, matching the frontend's stores; and
//! [`number`] / [`clamp_span`] read and clamp a tool's explicit span.

use std::collections::HashMap;

use serde_json::Value;

use crate::audio::analysis::{
    canonical_option_key, Axis, Shape, SharedParams, ToolOptions, WindowKind,
};
use crate::audio::analyzers::{AnalyzerId, ToolId};

/// The default shared params, matching the frontend's initial store values
/// (`src/state/analysis.ts`): 2048-point Hann, 75% overlap, no resample, full band.
pub(super) fn default_params() -> SharedParams {
    SharedParams {
        fft_size: 2048,
        hop: 0.25,
        randomized_overlap: false,
        window_fn: WindowKind::Hann,
        channel: None,
        resample_to: None,
        freq_min_hz: 0.0,
        freq_max_hz: 0.0,
    }
}

/// Merge a partial shared-params patch (camelCase keys), matching the frontend.
///
/// Every known key is **type-checked** and range-checked against the engine's own clamps
/// before it is stored: a wrong-typed or out-of-range value is an error, never silently
/// ignored while the call reports success (audit P2 #10).
pub(super) fn merge_params(params: &mut SharedParams, value: &Value) -> Result<(), String> {
    let Some(map) = value.as_object() else {
        return Err("`params` must be an object".to_string());
    };
    for (key, value) in map {
        match key.as_str() {
            "fftSize" => {
                let size = number_in(value, key, 64.0, 32_768.0)?;
                params.fft_size = size as usize;
            }
            "hop" => params.hop = number_in(value, key, 0.01, 1.0)?,
            "randomizedOverlap" => {
                params.randomized_overlap = value
                    .as_bool()
                    .ok_or_else(|| "`randomizedOverlap` must be a boolean".to_string())?;
            }
            "windowFn" => {
                params.window_fn = serde_json::from_value(value.clone())
                    .map_err(|err| format!("invalid `windowFn`: {err}"))?;
            }
            "channel" => {
                params.channel = match value {
                    Value::Null => None,
                    other => Some(number_in(other, key, 0.0, 65_535.0)? as usize),
                };
            }
            "resampleTo" => {
                params.resample_to = match value {
                    Value::Null => None,
                    other => Some(number_in(other, key, 1.0, 768_000.0)? as u32),
                };
            }
            "freqMinHz" => params.freq_min_hz = number_in(value, key, 0.0, 768_000.0)?,
            "freqMaxHz" => params.freq_max_hz = number_in(value, key, 0.0, 768_000.0)?,
            other => return Err(format!("unknown shared param: {other}")),
        }
    }
    Ok(())
}

/// Read a required finite number for `key`, inside `[min, max]`.
fn number_in(value: &Value, key: &str, min: f64, max: f64) -> Result<f64, String> {
    let number = value
        .as_f64()
        .filter(|number| number.is_finite())
        .ok_or_else(|| format!("`{key}` must be a finite number"))?;
    if number < min || number > max {
        return Err(format!(
            "`{key}` must be between {min} and {max} (got {number})"
        ));
    }
    Ok(number)
}

/// Read a required analyzer id from a tool's arguments (parsed once, here).
pub(super) fn analyzer(args: &Value, key: &str) -> Result<AnalyzerId, String> {
    let value = args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("`{key}` is required"))?;
    value
        .parse()
        .map_err(|_| format!("unknown analyzer: {value}"))
}

/// Read a required Workbench tool id: an analyzer id, `filter`, or `synth`.
pub(super) fn tool_id(args: &Value) -> Result<ToolId, String> {
    let value = args
        .get("tool")
        .and_then(Value::as_str)
        .ok_or("`tool` is required")?;
    value.parse().map_err(|_| format!("unknown tool: {value}"))
}

/// Merge per-tool option overrides into `entry`, **validating** them against the tool's
/// catalog first (key applicability + declared range).
///
/// Keys are canonical camelCase with snake_case aliases accepted; a value must be a
/// number. Used by every override surface (`set_tool_options`, `run_analysis`'s
/// `options`, the CLI's `-o`), so none of them can accept an option that does not belong
/// to the tool or a value outside its range (audit P2 #10).
pub(super) fn merge_options(
    entry: &mut ToolOptions,
    tool: AnalyzerId,
    options: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    apply_options(entry, tool, options, true)
}

/// Apply options from a **saved project** without the catalog check: they were clamped
/// by the stores that wrote them, and an old file must still open.
pub(super) fn restore_options(
    entry: &mut ToolOptions,
    tool: AnalyzerId,
    options: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    apply_options(entry, tool, options, false)
}

fn apply_options(
    entry: &mut ToolOptions,
    tool: AnalyzerId,
    options: &serde_json::Map<String, Value>,
    validate: bool,
) -> Result<(), String> {
    for (key, value) in options {
        let canonical =
            canonical_option_key(key).ok_or_else(|| format!("unknown option for {tool}: {key}"))?;
        let number = value
            .as_f64()
            .ok_or_else(|| format!("option {canonical} for {tool} must be a number"))?;
        if validate {
            crate::audio::analyzers::check_option(tool, canonical, number)?;
        }
        match canonical {
            "nMels" => entry.n_mels = Some(number as usize),
            "nMfcc" => entry.n_mfcc = Some(number as usize),
            "nBands" => entry.n_bands = Some(number as usize),
            "rolloffPercent" => entry.rolloff_percent = Some(number as f32),
            "yinThreshold" => entry.yin_threshold = Some(number as f32),
            "minF0Hz" => entry.min_f0_hz = Some(number as f32),
            "maxF0Hz" => entry.max_f0_hz = Some(number as f32),
            "barLength" => entry.bar_length = Some(number as usize),
            "windowMs" => entry.window_ms = Some(number as u32),
            "fMinHz" => entry.f_min_hz = Some(number as f32),
            "fMaxHz" => entry.f_max_hz = Some(number as f32),
            "frameMs" => entry.frame_ms = Some(number as f32),
            "hopMs" => entry.hop_ms = Some(number as f32),
            "gateDb" => entry.gate_db = Some(number as f32),
            "gateFloorDb" => entry.gate_floor_db = Some(number as f32),
            "hysteresisDb" => entry.hysteresis_db = Some(number as f32),
            "minNoteMs" => entry.min_note_ms = Some(number as f32),
            "minGapMs" => entry.min_gap_ms = Some(number as f32),
            "syllableGapMs" => entry.syllable_gap_ms = Some(number as f32),
            "envelopePoints" => entry.envelope_points = Some(number as usize),
            "pitchFrameMs" => entry.pitch_frame_ms = Some(number as f32),
            "pitchHopMs" => entry.pitch_hop_ms = Some(number as f32),
            "modMinHz" => entry.mod_min_hz = Some(number as f32),
            "modMaxHz" => entry.mod_max_hz = Some(number as f32),
            "detrend" => entry.detrend = Some(number.max(0.0) as usize),
            "minVoicedSecs" => entry.min_voiced_secs = Some(number as f32),
            "topPeaks" => entry.top_peaks = Some(number.max(0.0) as usize),
            "scale" => entry.scale = Some(number.max(0.0) as usize),
            "calibrationDbSpl" => entry.calibration_db_spl = Some(number as f32),
            other => return Err(format!("unknown option for {tool}: {other}")),
        }
    }
    Ok(())
}

/// Read a required finite number from a tool's arguments.
pub(super) fn number(args: &Value, key: &str) -> Result<f64, String> {
    args.get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("`{key}` must be a finite number"))
}

/// Clamp a span to the source and order it (matching the GUI's `clampSet`).
pub(super) fn clamp_span(start: f64, end: f64, duration: f64) -> (f64, f64) {
    let mut a = start;
    let mut b = end;
    if duration > 0.0 {
        a = a.clamp(0.0, duration);
        b = b.clamp(0.0, duration);
    }
    if a > b {
        std::mem::swap(&mut a, &mut b);
    }
    (a, b)
}

/// Whether a call's overrides apply to this call only (`transient`).
pub(super) fn transient(args: &Value) -> bool {
    args.get("transient")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// The effective shared params for a call: a `params` patch merges into a local copy
/// when the call is transient, otherwise it persists in `stored`.
pub(super) fn effective_params(
    stored: &mut SharedParams,
    args: &Value,
    transient: bool,
) -> Result<SharedParams, String> {
    let mut params = stored.clone();
    if let Some(patch) = args.get("params").filter(|value| !value.is_null()) {
        if transient {
            merge_params(&mut params, patch)?;
        } else {
            merge_params(stored, patch)?;
            params = stored.clone();
        }
    }
    Ok(params)
}

/// The effective per-tool options for a call, under the same persistence rule.
pub(super) fn effective_options(
    stored: &mut HashMap<AnalyzerId, ToolOptions>,
    tool: AnalyzerId,
    args: &Value,
    transient: bool,
) -> Result<ToolOptions, String> {
    let mut options = stored.get(&tool).cloned().unwrap_or_default();
    if let Some(patch) = args.get("options").and_then(Value::as_object) {
        if transient {
            merge_options(&mut options, tool, patch)?;
        } else {
            let entry = stored.entry(tool).or_default();
            merge_options(entry, tool, patch)?;
            options = stored.get(&tool).cloned().unwrap_or_default();
        }
    }
    Ok(options)
}

/// The effective analysis window (clamped to the source), plus whether the call named
/// an explicit `start`/`end` (which persists unless the call is transient).
pub(super) fn effective_window(
    stored: (f64, f64),
    args: &Value,
    duration: f64,
) -> ((f64, f64), bool) {
    let explicit = args.get("start").is_some() || args.get("end").is_some();
    let start = args
        .get("start")
        .and_then(Value::as_f64)
        .unwrap_or(stored.0);
    let end = args.get("end").and_then(Value::as_f64).unwrap_or(stored.1);
    (clamp_span(start, end, duration), explicit)
}

/// The requested result shape, its point cap, and the axis spelling.
pub(super) fn output_mode(args: &Value) -> Result<(Shape, Option<usize>, Axis), String> {
    let summary_only = args
        .get("summaryOnly")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let include_data = args
        .get("includeData")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if summary_only && include_data {
        return Err("`summaryOnly` and `includeData` are mutually exclusive".to_string());
    }
    let shape = if summary_only {
        Shape::Summary
    } else if include_data {
        Shape::Full
    } else {
        Shape::Compact
    };
    let max_points = args
        .get("maxPoints")
        .and_then(Value::as_u64)
        .map(|points| points as usize);
    // Full results can spell uniform time axes compactly; the default keeps arrays.
    let axis = match args.get("axis").and_then(Value::as_str) {
        Some("compact") => Axis::Compact,
        _ => Axis::Array,
    };
    Ok((shape, max_points, axis))
}
