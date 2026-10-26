//! Argument and shared-params helpers for the headless dispatch table.
//!
//! [`default_params`] seeds the session; [`merge_params`] / [`merge_options`] apply
//! the camelCase patch objects an agent sends, matching the frontend's stores; and
//! [`number`] / [`clamp_span`] read and clamp a tool's explicit span.

use serde_json::Value;

use crate::audio::analysis::{canonical_option_key, SharedParams, ToolOptions, WindowKind};

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
pub(super) fn merge_params(params: &mut SharedParams, value: &Value) -> Result<(), String> {
    let Some(map) = value.as_object() else {
        return Err("`params` must be an object".to_string());
    };
    for (key, value) in map {
        match key.as_str() {
            "fftSize" => {
                if let Some(size) = value.as_u64() {
                    params.fft_size = size as usize;
                }
            }
            "hop" => {
                if let Some(hop) = value.as_f64() {
                    params.hop = hop;
                }
            }
            "randomizedOverlap" => {
                if let Some(flag) = value.as_bool() {
                    params.randomized_overlap = flag;
                }
            }
            "windowFn" => {
                params.window_fn = serde_json::from_value(value.clone())
                    .map_err(|err| format!("invalid `windowFn`: {err}"))?;
            }
            "channel" => {
                params.channel = if value.is_null() {
                    None
                } else {
                    value.as_u64().map(|channel| channel as usize)
                };
            }
            "resampleTo" => {
                params.resample_to = if value.is_null() {
                    None
                } else {
                    value.as_u64().map(|rate| rate as u32)
                };
            }
            "freqMinHz" => {
                if let Some(hz) = value.as_f64() {
                    params.freq_min_hz = hz;
                }
            }
            "freqMaxHz" => {
                if let Some(hz) = value.as_f64() {
                    params.freq_max_hz = hz;
                }
            }
            other => return Err(format!("unknown shared param: {other}")),
        }
    }
    Ok(())
}

/// Merge per-tool option overrides into `entry`. Keys are canonical camelCase,
/// with their snake_case aliases accepted; a value must be a number and an unknown
/// key is an error (never silent).
pub(super) fn merge_options(
    entry: &mut ToolOptions,
    tool: &str,
    options: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    for (key, value) in options {
        let canonical =
            canonical_option_key(key).ok_or_else(|| format!("unknown option for {tool}: {key}"))?;
        let number = value
            .as_f64()
            .ok_or_else(|| format!("option {canonical} for {tool} must be a number"))?;
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
