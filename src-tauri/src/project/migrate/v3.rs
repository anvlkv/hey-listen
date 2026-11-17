//! Version 3 → 4: a stored comparison result gains two trailing optional fields.
//!
//! `MatrixResult` gained `bandLabels` (its postcard tuple went 17 → 18) and
//! `CalibratedSeriesResult` gained `gate` (11 → 12). `postcard` is positional and the
//! result is **nested** inside a `SavedComparison` (snapshot fields follow it), so the
//! mirror's "missing trailing field = default" tolerance cannot help here: it would read
//! the snapshot's following fields instead of stopping. Version 3 wrote the 17 / 11
//! shape, so this step decodes it with a frozen mirror and re-encodes the current shape.
//!
//! The frozen types are **release snapshots**: never edit them.

use serde::{Deserialize, Serialize};

use crate::audio::analysis::compare::{SavedComparison, SourceShape, Span};
use crate::audio::analysis::{
    Contribution, RateContribution, SharedParams, StoredAnalysisResult, StoredCalibratedSeries,
    StoredMatrix, ToolOptions,
};
use crate::audio::analyzers::AnalyzerId;
use crate::project::ProjectError;

use super::Sections;

/// The first sixteen [`StoredMatrix`] fields version 3 wrote.
type MatrixFieldsV3 = (
    u32,
    usize,
    usize,
    usize,
    f32,
    Vec<f32>,
    f64,
    Vec<f32>,
    Vec<f32>,
    f32,
    f32,
    Option<Vec<f32>>,
    Option<String>,
    bool,
    f32,
    Option<String>,
);

/// The [`StoredMatrix`] version 3 wrote: [`MatrixFieldsV3`] plus `normalized`, before
/// `bandLabels`. A tuple struct encodes as the same flat 17-value postcard sequence.
#[derive(Serialize, Deserialize)]
pub(super) struct StoredMatrixV3(pub MatrixFieldsV3, pub Option<bool>);

impl From<StoredMatrixV3> for StoredMatrix {
    fn from(StoredMatrixV3(fields, normalized): StoredMatrixV3) -> Self {
        let (
            sample_rate,
            hop_size,
            frames,
            bins,
            duration,
            times,
            window_start,
            bands,
            values,
            min_value,
            max_value,
            band_edges,
            unit,
            calibrated,
            calibration_db_spl,
            model,
        ) = fields;
        Self {
            sample_rate,
            hop_size,
            frames,
            bins,
            duration,
            times,
            window_start,
            bands,
            values,
            min_value,
            max_value,
            band_edges,
            unit,
            calibrated,
            calibration_db_spl,
            model,
            normalized,
            band_labels: None,
        }
    }
}

/// The [`StoredCalibratedSeries`] field tuple version 3 wrote (11 fields, before `gate`).
pub(super) type StoredCalibratedSeriesV3 = (
    u32,
    usize,
    f64,
    Vec<f32>,
    Vec<Option<f32>>,
    f32,
    f32,
    bool,
    f32,
    Option<Contribution>,
    Option<RateContribution>,
);

impl From<StoredCalibratedSeriesV3> for StoredCalibratedSeries {
    fn from(old: StoredCalibratedSeriesV3) -> Self {
        let (
            sample_rate,
            hop_size,
            window_start,
            times,
            values,
            min_value,
            max_value,
            calibrated,
            calibration_db_spl,
            contribution,
            rate_contribution,
        ) = old;
        Self {
            sample_rate,
            hop_size,
            window_start,
            times,
            values,
            min_value,
            max_value,
            calibrated,
            calibration_db_spl,
            contribution,
            rate_contribution,
            gate: None,
        }
    }
}

crate::stored_result_enum! {
    /// The postcard-safe mirror of [`StoredAnalysisResult`] as version 3 wrote it.
    #[derive(Serialize, Deserialize)]
    pub(super) enum StoredAnalysisResultV3 {
        matrix = StoredMatrixV3,
        series = StoredCalibratedSeriesV3,
    }
}

impl From<StoredAnalysisResultV3> for StoredAnalysisResult {
    fn from(old: StoredAnalysisResultV3) -> Self {
        use StoredAnalysisResultV3 as V3;
        match old {
            V3::Waveform(v) => Self::Waveform(v),
            V3::Spectrum(v) => Self::Spectrum(v),
            V3::Spectrogram(v) => Self::Spectrogram(v),
            V3::Levels(v) => Self::Levels(v),
            V3::FrameRms(v) => Self::FrameRms(v),
            V3::MelSpectrogram(v) => Self::MelSpectrogram(v.into()),
            V3::Mfcc(v) => Self::Mfcc(v.into()),
            V3::Chromagram(v) => Self::Chromagram(v.into()),
            V3::SpectralContrast(v) => Self::SpectralContrast(v.into()),
            V3::SpectralCentroid(v) => Self::SpectralCentroid(v),
            V3::SpectralFlux(v) => Self::SpectralFlux(v),
            V3::SpectralRolloff(v) => Self::SpectralRolloff(v),
            V3::SpectralFlatness(v) => Self::SpectralFlatness(v),
            V3::SpectralBandwidth(v) => Self::SpectralBandwidth(v),
            V3::SpectralEntropy(v) => Self::SpectralEntropy(v),
            V3::SpectralCrest(v) => Self::SpectralCrest(v),
            V3::HarmonicRatio(v) => Self::HarmonicRatio(v),
            V3::ZeroCrossingRate(v) => Self::ZeroCrossingRate(v),
            V3::PitchPyin(v) => Self::PitchPyin(v),
            V3::PitchYin(v) => Self::PitchYin(v),
            V3::PitchAutocorr(v) => Self::PitchAutocorr(v),
            V3::NoteMetrics(v) => Self::NoteMetrics(v),
            V3::Modulation(v) => Self::Modulation(v),
            V3::Tempo(v) => Self::Tempo(v),
            V3::Onsets(v) => Self::Onsets(v),
            V3::Downbeats(v) => Self::Downbeats(v),
            V3::LoudnessIntegrated(v) => Self::LoudnessIntegrated(v),
            V3::LoudnessMomentary(v) => Self::LoudnessMomentary(v),
            V3::LoudnessRange(v) => Self::LoudnessRange(v),
            V3::CriticalBands(v) => Self::CriticalBands(v.into()),
            V3::Loudness(v) => Self::Loudness(v),
            V3::SpecificLoudness(v) => Self::SpecificLoudness(v.into()),
            V3::Sharpness(v) => Self::Sharpness(v.into()),
            V3::Roughness(v) => Self::Roughness(v.into()),
            V3::FluctuationStrength(v) => Self::FluctuationStrength(v.into()),
            V3::Masking(v) => Self::Masking(v),
            V3::Tonality(v) => Self::Tonality(v.into()),
            V3::Spatial(v) => Self::Spatial(v),
        }
    }
}

/// The `COMPARE` snapshot version 3 wrote: today's fields, with the 17 / 11 result.
#[derive(Serialize, Deserialize)]
pub(super) struct SavedComparisonV3 {
    pub tool: AnalyzerId,
    pub reference_name: String,
    pub source: SourceShape,
    pub window: Span,
    pub params: SharedParams,
    pub options: ToolOptions,
    pub filter_fingerprint: Option<String>,
    pub b_offset: f64,
    pub saved_ms: u64,
    pub result: StoredAnalysisResultV3,
    pub reference_path: Option<String>,
    pub id: String,
    pub owner_window: Span,
    pub owner_channel: Option<usize>,
}

impl From<SavedComparisonV3> for SavedComparison {
    fn from(old: SavedComparisonV3) -> Self {
        Self {
            tool: old.tool,
            reference_name: old.reference_name,
            source: old.source,
            window: old.window,
            params: old.params,
            options: old.options,
            filter_fingerprint: old.filter_fingerprint,
            b_offset: old.b_offset,
            saved_ms: old.saved_ms,
            result: old.result.into(),
            reference_path: old.reference_path,
            id: old.id,
            owner_window: old.owner_window,
            owner_channel: old.owner_channel,
        }
    }
}

/// Rewrite a version-3 `COMPARE` payload in the version-4 layout.
pub(super) fn from_v3_to_v4(sections: &mut Sections) -> Result<(), ProjectError> {
    if let Some(bytes) = sections.compare.as_deref() {
        sections.replace_compare(
            snapshots(bytes),
            "dropping the saved comparisons (a version 3 payload cannot be read)",
        )?;
    }
    sections.version += 1;
    Ok(())
}

/// Decode a version-3 payload, or a current one written under a version-3 header.
fn snapshots(bytes: &[u8]) -> Option<Vec<SavedComparison>> {
    if let Some(old) = Sections::decode_exact::<Vec<SavedComparisonV3>>(bytes) {
        return Some(old.into_iter().map(SavedComparison::from).collect());
    }
    Sections::decode_exact::<Vec<SavedComparison>>(bytes)
}
