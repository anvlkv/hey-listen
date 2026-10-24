//! The wire form of [`ToolOptions`] and the canonical option-key table.
//!
//! It lives apart from [`super::ToolOptions`] because ts-rs does not understand
//! `serde(alias)` (it emits a warning per field), and the aliases are only needed when
//! *reading* an external request. Split out to keep `types.rs` small.

use serde::Deserialize;

use super::ToolOptions;

/// The wire form of [`ToolOptions`], accepting snake_case aliases and rejecting
/// unknown keys.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolOptionsWire {
    #[serde(default, alias = "n_mels")]
    n_mels: Option<usize>,
    #[serde(default, alias = "n_mfcc")]
    n_mfcc: Option<usize>,
    #[serde(default, alias = "n_bands")]
    n_bands: Option<usize>,
    #[serde(default, alias = "rolloff_percent")]
    rolloff_percent: Option<f32>,
    #[serde(default, alias = "yin_threshold")]
    yin_threshold: Option<f32>,
    #[serde(default, alias = "min_f0_hz")]
    min_f0_hz: Option<f32>,
    #[serde(default, alias = "max_f0_hz")]
    max_f0_hz: Option<f32>,
    #[serde(default, alias = "bar_length")]
    bar_length: Option<usize>,
    #[serde(default, alias = "window_ms")]
    window_ms: Option<u32>,
    #[serde(default, alias = "f_min_hz")]
    f_min_hz: Option<f32>,
    #[serde(default, alias = "f_max_hz")]
    f_max_hz: Option<f32>,
    #[serde(default, alias = "frame_ms")]
    frame_ms: Option<f32>,
    #[serde(default, alias = "hop_ms")]
    hop_ms: Option<f32>,
    #[serde(default, alias = "gate_db")]
    gate_db: Option<f32>,
    #[serde(default, alias = "gate_floor_db")]
    gate_floor_db: Option<f32>,
    #[serde(default, alias = "hysteresis_db")]
    hysteresis_db: Option<f32>,
    #[serde(default, alias = "min_note_ms")]
    min_note_ms: Option<f32>,
    #[serde(default, alias = "min_gap_ms")]
    min_gap_ms: Option<f32>,
    #[serde(default, alias = "envelope_points")]
    envelope_points: Option<usize>,
    #[serde(default, alias = "pitch_frame_ms")]
    pitch_frame_ms: Option<f32>,
    #[serde(default, alias = "pitch_hop_ms")]
    pitch_hop_ms: Option<f32>,
}

impl From<ToolOptionsWire> for ToolOptions {
    fn from(wire: ToolOptionsWire) -> Self {
        Self {
            n_mels: wire.n_mels,
            n_mfcc: wire.n_mfcc,
            n_bands: wire.n_bands,
            rolloff_percent: wire.rolloff_percent,
            yin_threshold: wire.yin_threshold,
            min_f0_hz: wire.min_f0_hz,
            max_f0_hz: wire.max_f0_hz,
            bar_length: wire.bar_length,
            window_ms: wire.window_ms,
            f_min_hz: wire.f_min_hz,
            f_max_hz: wire.f_max_hz,
            frame_ms: wire.frame_ms,
            hop_ms: wire.hop_ms,
            gate_db: wire.gate_db,
            gate_floor_db: wire.gate_floor_db,
            hysteresis_db: wire.hysteresis_db,
            min_note_ms: wire.min_note_ms,
            min_gap_ms: wire.min_gap_ms,
            envelope_points: wire.envelope_points,
            pitch_frame_ms: wire.pitch_frame_ms,
            pitch_hop_ms: wire.pitch_hop_ms,
        }
    }
}

impl<'de> Deserialize<'de> for ToolOptions {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        ToolOptionsWire::deserialize(deserializer).map(Self::from)
    }
}

/// The canonical camelCase name for an engine option key, accepting its snake_case
/// alias. `None` means the key is not a per-tool engine option. Keep the canonical
/// names in step with [`ToolOptions`] and the analyzer catalog's option metadata.
pub fn canonical_option_key(key: &str) -> Option<&'static str> {
    Some(match key {
        "nMels" | "n_mels" => "nMels",
        "nMfcc" | "n_mfcc" => "nMfcc",
        "nBands" | "n_bands" => "nBands",
        "rolloffPercent" | "rolloff_percent" => "rolloffPercent",
        "yinThreshold" | "yin_threshold" => "yinThreshold",
        "minF0Hz" | "min_f0_hz" => "minF0Hz",
        "maxF0Hz" | "max_f0_hz" => "maxF0Hz",
        "barLength" | "bar_length" => "barLength",
        "windowMs" | "window_ms" => "windowMs",
        "fMinHz" | "f_min_hz" => "fMinHz",
        "fMaxHz" | "f_max_hz" => "fMaxHz",
        "frameMs" | "frame_ms" => "frameMs",
        "hopMs" | "hop_ms" => "hopMs",
        "gateDb" | "gate_db" => "gateDb",
        "gateFloorDb" | "gate_floor_db" => "gateFloorDb",
        "hysteresisDb" | "hysteresis_db" => "hysteresisDb",
        "minNoteMs" | "min_note_ms" => "minNoteMs",
        "minGapMs" | "min_gap_ms" => "minGapMs",
        "envelopePoints" | "envelope_points" => "envelopePoints",
        "pitchFrameMs" | "pitch_frame_ms" => "pitchFrameMs",
        "pitchHopMs" | "pitch_hop_ms" => "pitchHopMs",
        _ => return None,
    })
}
