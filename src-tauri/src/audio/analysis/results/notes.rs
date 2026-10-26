//! The note-segmentation result types (M18/M19), split out of [`super`] to keep each
//! file inside the source-size budget.
//!
//! A **note** here is an acoustic event found by `noteMetrics` — distinct from a
//! project **annotation** (the M14 `Note` payload, user-authored commentary).

use serde::Serialize;

/// One detected audio **note** (a segment above the gate) with its level summary and
/// per-note voice-quality proxies.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NoteMetric {
    pub start_secs: f32,
    pub end_secs: f32,
    pub duration_secs: f32,
    /// Silence between the previous note and this one (leading silence for the first).
    pub gap_before_secs: f32,
    /// Silence between this note and the next one (trailing silence for the last).
    pub gap_after_secs: f32,
    pub rms_db: f32,
    pub peak_db: f32,
    /// `rms_db` relative to the reference (loudest) note — 0 for the reference.
    pub rms_db_rel_loudest: f32,
    /// `peak_db` relative to the reference (loudest) note.
    pub peak_db_rel_loudest: f32,
    /// Frame-RMS envelope at `NoteMetricsResult::envelope_positions` (dBFS).
    pub envelope_db: Vec<f32>,
    /// Fraction of the note's own pitch frames the detector found voiced (0…1).
    /// `None` when the note is too short to yield a pitch frame.
    pub voiced_fraction: Option<f32>,
    /// Median f0 over the note's voiced pitch frames, in Hz.
    pub f0_median_hz: Option<f32>,
    /// **Jitter proxy**: population standard deviation of the note's linearly
    /// detrended f0 track, in cents. Not clinical jitter rate; `None` when too few
    /// voiced frames were found.
    pub jitter_proxy_cents: Option<f32>,
    /// **Shimmer proxy**: population standard deviation of the note's frame-RMS levels,
    /// in dB. `None` when there are too few frames.
    pub shimmer_proxy_db: Option<f32>,
    /// **HNR proxy**: mean 0–1 autocorrelation periodicity over the note. This is the
    /// `harmonic_ratio` score, **not** HNR in dB; near zero means noise-like.
    pub hnr_proxy: Option<f32>,
}

/// A silence **gap** between two detected notes. Leading/trailing silence is not
/// listed here (it is reflected in the first / last note's gap fields).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GapMetric {
    pub start_secs: f32,
    pub end_secs: f32,
    pub duration_secs: f32,
}

/// A **syllable**: one or more adjacent notes whose separating gap is shorter than
/// the requested `syllableGapMs` (M21.B). Grouping is separate from detection, so the
/// note spans are never changed by it; amplitude belongs to the syllable, not a note.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SyllableMetric {
    pub start_secs: f32,
    pub end_secs: f32,
    pub duration_secs: f32,
    /// How many detected notes this syllable merges.
    pub note_count: usize,
    /// RMS and peak level over the whole syllable, in dBFS. Measuring amplitude once
    /// per syllable — not per gate-closed note — is what the bird-vocals regression
    /// asked for.
    pub rms_db: f32,
    pub peak_db: f32,
}

/// Note segmentation over the window: the detected notes, the gaps between them, and
/// the summary an agent needs without reading every record (M18).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NoteMetricsResult {
    /// Source seconds where the window starts (all `*_secs` values are source seconds).
    pub window_start: f64,
    pub note_count: usize,
    pub gap_count: usize,
    /// Sum of the gaps **between** notes (leading/trailing silence excluded).
    pub total_gap_secs: f32,
    pub longest_gap_secs: f32,
    pub median_note_secs: f32,
    pub median_gap_secs: f32,
    /// The gate actually used: `max(gateFloorDb, windowPeakDb − gateDb)`.
    pub threshold_db: f32,
    /// Normalized positions (0…1) of each note's `envelope_db` samples.
    pub envelope_positions: Vec<f32>,
    /// Index of the loudest note (the level reference), if any.
    pub reference_note_index: Option<usize>,
    pub notes: Vec<NoteMetric>,
    pub gaps: Vec<GapMetric>,
    /// Notes grouped into syllables when `syllableGapMs` is set (M21.B). Absent when
    /// grouping is off, so the default result shape is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub syllables: Option<Vec<SyllableMetric>>,
}
