//! Input types for the analysis engine: the window function, the shared params,
//! the per-tool options, and the engine error. See `docs/data-model.md` and
//! `docs/analysis-tools.md`.

use oxiaudio::dsp::spectral::WindowFn;
use serde::{Deserialize, Serialize};

use super::{
    AUTOCORR_MAX_F0, AUTOCORR_MIN_F0, DB_FLOOR, DEFAULT_BAR_LENGTH, DEFAULT_ENVELOPE_POINTS,
    DEFAULT_FRAME_MS, DEFAULT_GATE_DB, DEFAULT_GATE_FLOOR_DB, DEFAULT_HOP_MS,
    DEFAULT_HYSTERESIS_DB, DEFAULT_MIN_GAP_MS, DEFAULT_MIN_NOTE_MS, DEFAULT_N_BANDS,
    DEFAULT_N_MELS, DEFAULT_N_MFCC, DEFAULT_ROLLOFF, DEFAULT_YIN_THRESHOLD, HARMONIC_MAX_F0,
    HARMONIC_MIN_F0, YIN_MAX_F0, YIN_MIN_F0,
};

/// A window function for frame-based tools (`docs/analysis-tools.md`).
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum WindowKind {
    #[default]
    Hann,
    Hamming,
    Blackman,
    Rectangular,
}

impl WindowKind {
    pub(super) fn to_window_fn(self) -> WindowFn {
        match self {
            WindowKind::Hann => WindowFn::Hann,
            WindowKind::Hamming => WindowFn::Hamming,
            WindowKind::Blackman => WindowFn::Blackman,
            WindowKind::Rectangular => WindowFn::Rectangular,
        }
    }
}

/// Shared analysis params, synced across tools in the frontend (ADR-6) and sent
/// with every `run_analysis` call. See `docs/data-model.md` → `SharedParams`.
///
/// Also `Serialize`/`Default` so the project file can persist the analysis setup.
#[derive(Debug, Clone, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SharedParams {
    /// FFT window size in samples (the UI offers 512…8192).
    pub fft_size: usize,
    /// Hop as a fraction of the window (0 < hop ≤ 1); 0.25 = 75% overlap.
    pub hop: f64,
    /// Optional overlap randomization (see [`super::support::stft_magnitudes`]).
    #[serde(default)]
    pub randomized_overlap: bool,
    pub window_fn: WindowKind,
    /// 0-based channel index, or `None` for a downmix of all channels.
    #[serde(default)]
    pub channel: Option<usize>,
    /// Optional analysis sample rate (resample before analysis).
    #[serde(default)]
    pub resample_to: Option<u32>,
    /// Band limit for **spectral** tools, in Hz (pitch tools use their own f0 range).
    #[serde(default)]
    pub freq_min_hz: f64,
    #[serde(default)]
    pub freq_max_hz: f64,
}

impl SharedParams {
    /// The FFT size clamped to a sane range.
    pub(super) fn fft_size(&self) -> usize {
        self.fft_size.clamp(64, 32_768)
    }

    /// The hop converted to samples (≥ 1) for `fft`.
    pub(super) fn hop_size(&self, fft: usize) -> usize {
        let hop = if self.hop.is_finite() { self.hop } else { 0.25 };
        ((fft as f64) * hop.clamp(0.01, 1.0)).round().max(1.0) as usize
    }

    /// The band-limit range clamped to `[0, nyquist]`.
    pub(super) fn band(&self, sample_rate: u32) -> (f64, f64) {
        let nyquist = f64::from(sample_rate) / 2.0;
        let min = if self.freq_min_hz.is_finite() {
            self.freq_min_hz.max(0.0)
        } else {
            0.0
        };
        let max = if self.freq_max_hz.is_finite() && self.freq_max_hz > 0.0 {
            self.freq_max_hz.min(nyquist)
        } else {
            nyquist
        };
        (min, max.max(min))
    }
}

/// Errors produced by the analysis engine.
#[derive(Debug, thiserror::Error)]
pub enum AnalysisError {
    #[error("no audio source is loaded")]
    NoSource,
    #[error("the analysis window is empty")]
    EmptyWindow,
    #[error("unknown analysis tool: {0}")]
    UnknownTool(String),
    #[error("analysis failed: {0}")]
    Analysis(String),
    #[error("filter graph failed to apply: {0}")]
    Filter(String),
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(AnalysisError);

/// Per-tool options (not shared across tools). Absent fields fall back to the tool
/// defaults; see `docs/analysis-tools.md`.
///
/// Keys are canonical **camelCase**; snake_case aliases are accepted when reading a
/// request (the IPC, headless, and CLI boundaries), and unknown keys are rejected rather
/// than silently ignored.
#[derive(Debug, Clone, Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ToolOptions {
    pub n_mels: Option<usize>,
    pub n_mfcc: Option<usize>,
    pub n_bands: Option<usize>,
    pub rolloff_percent: Option<f32>,
    pub yin_threshold: Option<f32>,
    pub min_f0_hz: Option<f32>,
    pub max_f0_hz: Option<f32>,
    pub bar_length: Option<usize>,
    pub window_ms: Option<u32>,
    pub f_min_hz: Option<f32>,
    pub f_max_hz: Option<f32>,
    pub frame_ms: Option<f32>,
    pub hop_ms: Option<f32>,
    pub gate_db: Option<f32>,
    pub gate_floor_db: Option<f32>,
    pub hysteresis_db: Option<f32>,
    pub min_note_ms: Option<f32>,
    pub min_gap_ms: Option<f32>,
    pub envelope_points: Option<usize>,
}

/// The wire form of [`ToolOptions`]. It lives apart from the exported type because
/// ts-rs does not understand `serde(alias)` (it emits a warning per field), and the
/// aliases are only needed when *reading* an external request.
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
        _ => return None,
    })
}

impl ToolOptions {
    pub(super) fn n_mels(&self) -> usize {
        self.n_mels.unwrap_or(DEFAULT_N_MELS).clamp(8, 256)
    }

    pub(super) fn n_mfcc(&self) -> usize {
        self.n_mfcc.unwrap_or(DEFAULT_N_MFCC).clamp(1, 64)
    }

    pub(super) fn n_bands(&self) -> usize {
        self.n_bands.unwrap_or(DEFAULT_N_BANDS).clamp(2, 16)
    }

    pub(super) fn rolloff_percent(&self) -> f32 {
        self.rolloff_percent
            .unwrap_or(DEFAULT_ROLLOFF)
            .clamp(0.01, 0.99)
    }

    pub(super) fn yin_threshold(&self) -> f32 {
        self.yin_threshold
            .unwrap_or(DEFAULT_YIN_THRESHOLD)
            .clamp(0.01, 0.9)
    }

    /// Resolve a pitch range from the per-tool `minF0Hz` / `maxF0Hz`, falling back to
    /// this tool's defaults. A missing or non-finite value uses the default, and the
    /// resolved range is always ordered.
    fn f0_range(&self, default_min: f32, default_max: f32) -> (f32, f32) {
        let min = self
            .min_f0_hz
            .filter(|value| value.is_finite())
            .unwrap_or(default_min)
            .max(1.0);
        let max = self
            .max_f0_hz
            .filter(|value| value.is_finite())
            .unwrap_or(default_max);
        (min, max.max(min + 1.0))
    }

    pub(super) fn yin_range(&self) -> (f32, f32) {
        self.f0_range(YIN_MIN_F0, YIN_MAX_F0)
    }

    pub(super) fn autocorr_range(&self) -> (f32, f32) {
        self.f0_range(AUTOCORR_MIN_F0, AUTOCORR_MAX_F0)
    }

    pub(super) fn harmonic_range(&self) -> (f32, f32) {
        self.f0_range(HARMONIC_MIN_F0, HARMONIC_MAX_F0)
    }

    pub(super) fn bar_length(&self) -> usize {
        self.bar_length.unwrap_or(DEFAULT_BAR_LENGTH).clamp(2, 12)
    }

    pub(super) fn window_ms(&self) -> Option<u32> {
        self.window_ms.filter(|&ms| ms > 0)
    }

    pub(super) fn mel_f_min(&self) -> Option<f32> {
        self.f_min_hz.filter(|&f| f > 0.0)
    }

    pub(super) fn mel_f_max(&self) -> Option<f32> {
        self.f_max_hz.filter(|&f| f > 0.0)
    }

    /// The RMS frame length in ms (M17), clamped to a usable range.
    pub(super) fn frame_ms(&self) -> f32 {
        self.frame_ms
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(DEFAULT_FRAME_MS)
            .clamp(0.1, 1_000.0)
    }

    /// The envelope hop in ms (M17). May exceed the frame, leaving uncovered gaps.
    pub(super) fn hop_ms(&self) -> f32 {
        self.hop_ms
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(DEFAULT_HOP_MS)
            .clamp(0.05, 1_000.0)
    }

    /// How far below the window peak the note gate sits (M18).
    pub(super) fn gate_db(&self) -> f32 {
        self.gate_db
            .filter(|value| value.is_finite())
            .unwrap_or(DEFAULT_GATE_DB)
            .clamp(0.0, 120.0)
    }

    /// The absolute note-gate floor in dBFS (M18).
    pub(super) fn gate_floor_db(&self) -> f32 {
        self.gate_floor_db
            .filter(|value| value.is_finite())
            .unwrap_or(DEFAULT_GATE_FLOOR_DB)
            .clamp(DB_FLOOR, 0.0)
    }

    /// Hysteresis below the gate (M18): a note ends `hysteresisDb` under the threshold.
    pub(super) fn hysteresis_db(&self) -> f32 {
        self.hysteresis_db
            .filter(|value| value.is_finite())
            .unwrap_or(DEFAULT_HYSTERESIS_DB)
            .clamp(0.0, 24.0)
    }

    /// The shortest note kept, in ms (M18).
    pub(super) fn min_note_ms(&self) -> f32 {
        self.min_note_ms
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(DEFAULT_MIN_NOTE_MS)
            .clamp(0.0, 10_000.0)
    }

    /// Gaps shorter than this are merged into one note (M18).
    pub(super) fn min_gap_ms(&self) -> f32 {
        self.min_gap_ms
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(DEFAULT_MIN_GAP_MS)
            .clamp(0.0, 10_000.0)
    }

    /// Normalized envelope points per note (M18).
    pub(super) fn envelope_points(&self) -> usize {
        self.envelope_points
            .unwrap_or(DEFAULT_ENVELOPE_POINTS)
            .clamp(3, 16)
    }
}
