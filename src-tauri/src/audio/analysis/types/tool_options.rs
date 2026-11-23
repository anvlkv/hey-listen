//! Per-tool options and their accessors, split out of [`super`] to stay inside the
//! source-size budget.

use serde::Serialize;

use super::super::{
    AUTOCORR_MAX_F0, AUTOCORR_MIN_F0, DB_FLOOR, DEFAULT_BAR_LENGTH, DEFAULT_DETREND,
    DEFAULT_ENVELOPE_POINTS, DEFAULT_FRAME_MS, DEFAULT_GATE_DB, DEFAULT_GATE_FLOOR_DB,
    DEFAULT_HOP_MS, DEFAULT_HYSTERESIS_DB, DEFAULT_MIN_GAP_MS, DEFAULT_MIN_NOTE_MS,
    DEFAULT_MIN_VOICED_SECS, DEFAULT_MOD_MAX_HZ, DEFAULT_MOD_MIN_HZ, DEFAULT_N_BANDS,
    DEFAULT_N_MELS, DEFAULT_N_MFCC, DEFAULT_PITCH_FRAME_MS, DEFAULT_PITCH_HOP_MS, DEFAULT_ROLLOFF,
    DEFAULT_TOP_PEAKS, DEFAULT_YIN_THRESHOLD, HARMONIC_MAX_F0, HARMONIC_MIN_F0, PYIN_MAX_F0,
    PYIN_MIN_F0, YIN_MAX_F0, YIN_MIN_F0,
};

/// Per-tool options (not shared across tools). Absent fields fall back to the tool
/// defaults.
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
    pub syllable_gap_ms: Option<f32>,
    pub envelope_points: Option<usize>,
    pub pitch_frame_ms: Option<f32>,
    pub pitch_hop_ms: Option<f32>,
    pub mod_min_hz: Option<f32>,
    pub mod_max_hz: Option<f32>,
    pub detrend: Option<usize>,
    pub min_voiced_secs: Option<f32>,
    pub top_peaks: Option<usize>,
    pub scale: Option<usize>,
    /// The dB SPL of a full-scale sine (M27); `0` or absent means **uncalibrated**.
    pub calibration_db_spl: Option<f32>,
    /// `modulation`: `1` analyses each detected note segment separately and reports the
    /// per-note table, `0` (absent) analyses the whole window unchanged (D-18).
    pub per_note: Option<f32>,
}

/// How a modulation envelope is detrended before its spectrum is taken (M20).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Detrend {
    /// Remove the mean only (DC).
    Mean,
    /// Remove a least-squares line.
    Linear,
}

impl ToolOptions {
    pub(in crate::audio::analysis) fn n_mels(&self) -> usize {
        self.n_mels.unwrap_or(DEFAULT_N_MELS).clamp(8, 256)
    }

    pub(in crate::audio::analysis) fn n_mfcc(&self) -> usize {
        self.n_mfcc.unwrap_or(DEFAULT_N_MFCC).clamp(1, 64)
    }

    pub(in crate::audio::analysis) fn n_bands(&self) -> usize {
        self.n_bands.unwrap_or(DEFAULT_N_BANDS).clamp(2, 16)
    }

    pub(in crate::audio::analysis) fn rolloff_percent(&self) -> f32 {
        self.rolloff_percent
            .unwrap_or(DEFAULT_ROLLOFF)
            .clamp(0.01, 0.99)
    }

    pub(in crate::audio::analysis) fn yin_threshold(&self) -> f32 {
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

    pub(in crate::audio::analysis) fn yin_range(&self) -> (f32, f32) {
        self.f0_range(YIN_MIN_F0, YIN_MAX_F0)
    }

    pub(in crate::audio::analysis) fn autocorr_range(&self) -> (f32, f32) {
        self.f0_range(AUTOCORR_MIN_F0, AUTOCORR_MAX_F0)
    }

    pub(in crate::audio::analysis) fn harmonic_range(&self) -> (f32, f32) {
        self.f0_range(HARMONIC_MIN_F0, HARMONIC_MAX_F0)
    }

    /// pYIN's f0 search range (the detector takes it explicitly, unlike the crate's fixed
    /// 50–2000 Hz window).
    pub(in crate::audio::analysis) fn pyin_range(&self) -> (f32, f32) {
        self.f0_range(PYIN_MIN_F0, PYIN_MAX_F0)
    }

    pub(in crate::audio::analysis) fn bar_length(&self) -> usize {
        self.bar_length.unwrap_or(DEFAULT_BAR_LENGTH).clamp(2, 12)
    }

    pub(in crate::audio::analysis) fn window_ms(&self) -> Option<u32> {
        self.window_ms.filter(|&ms| ms > 0)
    }

    pub(in crate::audio::analysis) fn mel_f_min(&self) -> Option<f32> {
        self.f_min_hz.filter(|&f| f > 0.0)
    }

    pub(in crate::audio::analysis) fn mel_f_max(&self) -> Option<f32> {
        self.f_max_hz.filter(|&f| f > 0.0)
    }

    /// The RMS frame length in ms (M17), clamped to a usable range.
    pub(in crate::audio::analysis) fn frame_ms(&self) -> f32 {
        self.frame_ms
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(DEFAULT_FRAME_MS)
            .clamp(0.1, 1_000.0)
    }

    /// The envelope hop in ms (M17). May exceed the frame, leaving uncovered gaps.
    /// [`DEFAULT_HOP_MS`] is the unset fallback; the catalog's `hopMs` mirrors it so a
    /// no-option run reports what it computes.
    pub(in crate::audio::analysis) fn hop_ms(&self) -> f32 {
        self.hop_ms
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(DEFAULT_HOP_MS)
            .clamp(0.05, 1_000.0)
    }

    /// How far below the window peak the note gate sits (M18).
    pub(in crate::audio::analysis) fn gate_db(&self) -> f32 {
        self.gate_db
            .filter(|value| value.is_finite())
            .unwrap_or(DEFAULT_GATE_DB)
            .clamp(0.0, 120.0)
    }

    /// The absolute note-gate floor in dBFS (M18).
    pub(in crate::audio::analysis) fn gate_floor_db(&self) -> f32 {
        self.gate_floor_db
            .filter(|value| value.is_finite())
            .unwrap_or(DEFAULT_GATE_FLOOR_DB)
            .clamp(DB_FLOOR, 0.0)
    }

    /// Hysteresis below the gate (M18): a note ends `hysteresisDb` under the threshold.
    pub(in crate::audio::analysis) fn hysteresis_db(&self) -> f32 {
        self.hysteresis_db
            .filter(|value| value.is_finite())
            .unwrap_or(DEFAULT_HYSTERESIS_DB)
            .clamp(0.0, 24.0)
    }

    /// The shortest note kept, in ms (M18).
    pub(in crate::audio::analysis) fn min_note_ms(&self) -> f32 {
        self.min_note_ms
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(DEFAULT_MIN_NOTE_MS)
            .clamp(0.0, 10_000.0)
    }

    /// Gaps shorter than this are merged into one note (M18).
    pub(in crate::audio::analysis) fn min_gap_ms(&self) -> f32 {
        self.min_gap_ms
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(DEFAULT_MIN_GAP_MS)
            .clamp(0.0, 10_000.0)
    }

    /// The gap under which adjacent notes merge into one **syllable** (M21.B): the
    /// note spans stay as detected, and `syllables` groups them. `None` (or 0) leaves
    /// grouping off, so the default result shape is unchanged.
    pub(in crate::audio::analysis) fn syllable_gap_ms(&self) -> Option<f32> {
        self.syllable_gap_ms
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(|value| value.clamp(1.0, 10_000.0))
    }

    /// Whether `modulation` reports per-note readouts (D-18): `1` analyses each detected
    /// note segment separately, `0` (the default) analyses the whole window, unchanged.
    pub(in crate::audio::analysis) fn per_note(&self) -> bool {
        self.per_note
            .filter(|value| value.is_finite())
            .unwrap_or(0.0)
            > 0.0
    }

    /// The window gate for a series measurement (M21.B), in dB below the window
    /// peak. `None` disables gating, so a result is unchanged unless asked for.
    pub(in crate::audio::analysis) fn series_gate_db(&self) -> Option<f32> {
        self.gate_db
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(|value| value.clamp(1.0, 120.0))
    }

    /// The absolute floor of that gate, in dBFS. Defaults to [`DB_FLOOR`] (no floor)
    /// rather than the note gate's −60 dBFS, so a quiet recording is not gated away.
    pub(in crate::audio::analysis) fn series_gate_floor_db(&self) -> f32 {
        self.gate_floor_db
            .filter(|value| value.is_finite())
            .unwrap_or(DB_FLOOR)
            .clamp(DB_FLOOR, 0.0)
    }

    /// Normalized envelope points per note (M18).
    pub(in crate::audio::analysis) fn envelope_points(&self) -> usize {
        self.envelope_points
            .unwrap_or(DEFAULT_ENVELOPE_POINTS)
            .clamp(3, 16)
    }

    /// The frame length for the per-note pitch track, in ms (M19). The note's own grid
    /// is raised to at least ~3 periods of the lowest f0 by the pitch helper.
    pub(in crate::audio::analysis) fn pitch_frame_ms(&self) -> f32 {
        self.pitch_frame_ms
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(DEFAULT_PITCH_FRAME_MS)
            .clamp(5.0, 500.0)
    }

    /// The hop between per-note pitch frames, in ms (M19).
    pub(in crate::audio::analysis) fn pitch_hop_ms(&self) -> f32 {
        self.pitch_hop_ms
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(DEFAULT_PITCH_HOP_MS)
            .clamp(1.0, 1_000.0)
    }

    /// The f0 search range for the per-note quality proxies (M19), defaulting to YIN's.
    pub(in crate::audio::analysis) fn note_pitch_range(&self) -> (f32, f32) {
        self.f0_range(YIN_MIN_F0, YIN_MAX_F0)
    }

    /// The requested modulation-rate band in Hz (M20), always ordered.
    pub(in crate::audio::analysis) fn mod_range(&self) -> (f32, f32) {
        let min = self
            .mod_min_hz
            .filter(|value| value.is_finite())
            .unwrap_or(DEFAULT_MOD_MIN_HZ)
            .clamp(0.0, 10_000.0);
        let max = self
            .mod_max_hz
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(DEFAULT_MOD_MAX_HZ)
            .clamp(0.01, 20_000.0);
        (min, max.max(min + 0.01))
    }

    /// How the modulation envelope is detrended before the FFT (M20); `0` keeps the
    /// mean removal only, anything else is a linear fit (the default).
    pub(in crate::audio::analysis) fn detrend(&self) -> Detrend {
        if self.detrend.unwrap_or(DEFAULT_DETREND) == 0 {
            Detrend::Mean
        } else {
            Detrend::Linear
        }
    }

    /// The shortest voiced run the FM spectrum analyses, in seconds (M20).
    pub(in crate::audio::analysis) fn min_voiced_secs(&self) -> f32 {
        self.min_voiced_secs
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(DEFAULT_MIN_VOICED_SECS)
            .clamp(0.0, 60.0)
    }

    /// How many ranked peaks each spectrum returns (M20).
    pub(in crate::audio::analysis) fn top_peaks(&self) -> usize {
        self.top_peaks.unwrap_or(DEFAULT_TOP_PEAKS).clamp(1, 12)
    }

    /// The f0 search range for the modulation pitch track (M20), defaulting to YIN's.
    pub(in crate::audio::analysis) fn mod_pitch_range(&self) -> (f32, f32) {
        self.f0_range(YIN_MIN_F0, YIN_MAX_F0)
    }

    /// The critical-band scale for `criticalBands` (M26): `0` or absent is Bark,
    /// anything else is ERB.
    pub(in crate::audio::analysis) fn scale(
        &self,
    ) -> crate::audio::analysis::psychoacoustics::Scale {
        match self.scale {
            Some(0) | None => crate::audio::analysis::psychoacoustics::Scale::Bark,
            Some(_) => crate::audio::analysis::psychoacoustics::Scale::Erb,
        }
    }

    /// The loudness calibration (M27): the dB SPL of a full-scale sine. `0` (or any
    /// non-finite value) is uncalibrated, so values are relative to the tool's own unit.
    pub(in crate::audio::analysis) fn calibration_db_spl(&self) -> f32 {
        self.calibration_db_spl
            .filter(|value| value.is_finite())
            .unwrap_or(0.0)
            .clamp(0.0, 140.0)
    }
}
