//! Version 1 → 2: the `COMPARE` snapshot gains `referencePath`.
//!
//! A saved comparison appended the reference project's path **after** its first release,
//! so version 1 shipped two payload layouts: early v1 without the field, late v1 (the
//! layout 0.6.x released) with it. Version 2 makes the field part of the snapshot, so the
//! payload is rewritten here and the current decoder no longer has to guess (it used to,
//! at every load — see the M37 roadmap note and ADR-27's amendment).
//!
//! Version 1 also stored the result in an older arity: a **fifteen**-field matrix (before
//! M36 appended `model` / `normalized`) and a **nine**-field calibrated series (before the
//! `contribution` / `rateContribution` grids). The reader cannot tolerate that here — the
//! snapshot's own fields follow the nested result — so both v1 layouts decode through the
//! frozen [`StoredAnalysisResultV1`] mirror, which converts to version 2's 17 / 11 shape.
//!
//! The step leaves the payload in the **version-2** layout ([`SavedComparisonV2`]); the
//! next hop gives it its pair fields. Every other section is unchanged between v1 and v2
//! and passes through untouched.
//!
//! The frozen `…V1` types are **release snapshots**: never edit them.

use serde::{Deserialize, Serialize};

use crate::audio::analysis::compare::{SourceShape, Span};
use crate::audio::analysis::{SharedParams, ToolOptions};
use crate::audio::analyzers::AnalyzerId;
use crate::project::ProjectError;

use super::v2::SavedComparisonV2;
use super::v3::{StoredAnalysisResultV3, StoredCalibratedSeriesV3, StoredMatrixV3};
use super::Sections;

/// The first fifteen [`StoredMatrixV3`] fields version 1 wrote.
type MatrixFieldsV1 = (
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
);

/// The [`StoredMatrixV3`] version 1 wrote: [`MatrixFieldsV1`], before `model` /
/// `normalized`. A tuple struct encodes as the same flat 15-value postcard sequence.
#[derive(Serialize, Deserialize)]
pub(super) struct StoredMatrixV1(pub MatrixFieldsV1);

impl From<StoredMatrixV1> for StoredMatrixV3 {
    fn from(StoredMatrixV1(fields): StoredMatrixV1) -> Self {
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
        ) = fields;
        Self(
            (
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
                None,
            ),
            None,
        )
    }
}

/// The nine calibrated-series fields version 1 wrote.
type SeriesFieldsV1 = (
    u32,
    usize,
    f64,
    Vec<f32>,
    Vec<Option<f32>>,
    f32,
    f32,
    bool,
    f32,
);

/// The [`StoredCalibratedSeriesV3`] value version 1 wrote: [`SeriesFieldsV1`], before
/// M36's `contribution` / `rateContribution` grids. A tuple struct encodes as the same
/// flat nine-value postcard sequence.
#[derive(Serialize, Deserialize)]
pub(super) struct StoredCalibratedSeriesV1(pub SeriesFieldsV1);

impl From<StoredCalibratedSeriesV1> for StoredCalibratedSeriesV3 {
    fn from(StoredCalibratedSeriesV1(fields): StoredCalibratedSeriesV1) -> Self {
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
        ) = fields;
        (
            sample_rate,
            hop_size,
            window_start,
            times,
            values,
            min_value,
            max_value,
            calibrated,
            calibration_db_spl,
            None,
            None,
        )
    }
}

crate::stored_result_enum! {
    /// The postcard-safe mirror of the stored analysis result as version 1 wrote it.
    #[derive(Serialize, Deserialize)]
    pub(super) enum StoredAnalysisResultV1 {
        matrix = StoredMatrixV1,
        series = StoredCalibratedSeriesV1,
    }
}

impl From<StoredAnalysisResultV1> for StoredAnalysisResultV3 {
    fn from(old: StoredAnalysisResultV1) -> Self {
        use StoredAnalysisResultV1 as V1;
        match old {
            V1::Waveform(v) => Self::Waveform(v),
            V1::Spectrum(v) => Self::Spectrum(v),
            V1::Spectrogram(v) => Self::Spectrogram(v),
            V1::Levels(v) => Self::Levels(v),
            V1::FrameRms(v) => Self::FrameRms(v),
            V1::MelSpectrogram(v) => Self::MelSpectrogram(v.into()),
            V1::Mfcc(v) => Self::Mfcc(v.into()),
            V1::Chromagram(v) => Self::Chromagram(v.into()),
            V1::SpectralContrast(v) => Self::SpectralContrast(v.into()),
            V1::SpectralCentroid(v) => Self::SpectralCentroid(v),
            V1::SpectralFlux(v) => Self::SpectralFlux(v),
            V1::SpectralRolloff(v) => Self::SpectralRolloff(v),
            V1::SpectralFlatness(v) => Self::SpectralFlatness(v),
            V1::SpectralBandwidth(v) => Self::SpectralBandwidth(v),
            V1::SpectralEntropy(v) => Self::SpectralEntropy(v),
            V1::SpectralCrest(v) => Self::SpectralCrest(v),
            V1::HarmonicRatio(v) => Self::HarmonicRatio(v),
            V1::ZeroCrossingRate(v) => Self::ZeroCrossingRate(v),
            V1::PitchPyin(v) => Self::PitchPyin(v),
            V1::PitchYin(v) => Self::PitchYin(v),
            V1::PitchAutocorr(v) => Self::PitchAutocorr(v),
            V1::NoteMetrics(v) => Self::NoteMetrics(v),
            V1::Modulation(v) => Self::Modulation(v),
            V1::Tempo(v) => Self::Tempo(v),
            V1::Onsets(v) => Self::Onsets(v),
            V1::Downbeats(v) => Self::Downbeats(v),
            V1::LoudnessIntegrated(v) => Self::LoudnessIntegrated(v),
            V1::LoudnessMomentary(v) => Self::LoudnessMomentary(v),
            V1::LoudnessRange(v) => Self::LoudnessRange(v),
            V1::CriticalBands(v) => Self::CriticalBands(v.into()),
            V1::Loudness(v) => Self::Loudness(v),
            V1::SpecificLoudness(v) => Self::SpecificLoudness(v.into()),
            V1::Sharpness(v) => Self::Sharpness(v.into()),
            V1::Roughness(v) => Self::Roughness(v.into()),
            V1::FluctuationStrength(v) => Self::FluctuationStrength(v.into()),
            V1::Masking(v) => Self::Masking(v),
            V1::Tonality(v) => Self::Tonality(v.into()),
            V1::Spatial(v) => Self::Spatial(v),
        }
    }
}

/// The early-v1 `COMPARE` payload, written before `referencePath` existed.
///
/// `postcard` is positional, so the old payload decodes as a tuple in field order; the
/// conversion stores `None` for the path, so an existing project still loads (the view
/// then reports that the reference file is unknown instead of guessing one).
pub(super) type SavedComparisonV1 = (
    AnalyzerId,
    String,
    SourceShape,
    Span,
    SharedParams,
    ToolOptions,
    Option<String>,
    f64,
    u64,
    StoredAnalysisResultV1,
);

/// The late-v1 `COMPARE` payload — the fields released v1 wrote, with `referencePath`.
pub(super) type SavedComparisonV1Late = (
    AnalyzerId,
    String,
    SourceShape,
    Span,
    SharedParams,
    ToolOptions,
    Option<String>,
    f64,
    u64,
    StoredAnalysisResultV1,
    Option<String>,
);

/// Add the `referencePath` slot to an early-v1 snapshot (the version-2 layout).
fn to_v2(old: SavedComparisonV1) -> SavedComparisonV2 {
    let (
        tool,
        reference_name,
        source,
        window,
        params,
        options,
        filter_fingerprint,
        b_offset,
        saved_ms,
        result,
    ) = old;
    (
        tool,
        reference_name,
        source,
        window,
        params,
        options,
        filter_fingerprint,
        b_offset,
        saved_ms,
        result.into(),
        None,
    )
}

/// Convert a late-v1 snapshot: its fields are already version 2's, but its result is
/// version 1's arity.
fn late_to_v2(old: SavedComparisonV1Late) -> SavedComparisonV2 {
    let (
        tool,
        reference_name,
        source,
        window,
        params,
        options,
        filter_fingerprint,
        b_offset,
        saved_ms,
        result,
        reference_path,
    ) = old;
    (
        tool,
        reference_name,
        source,
        window,
        params,
        options,
        filter_fingerprint,
        b_offset,
        saved_ms,
        result.into(),
        reference_path,
    )
}

/// Rewrite a version-1 `COMPARE` payload in the version-2 layout.
pub(super) fn from_v1_to_v2(sections: &mut Sections) -> Result<(), ProjectError> {
    if let Some(bytes) = sections.compare.as_deref() {
        sections.replace_compare(
            snapshots(bytes),
            "dropping the saved comparisons (a version 1 payload cannot be read)",
        )?;
    }
    sections.version += 1;
    Ok(())
}

/// Decode a version-1 payload: the version-2 shape a development build may have written
/// under the same header, then the released late-v1 layout, then the early one.
fn snapshots(bytes: &[u8]) -> Option<Vec<SavedComparisonV2>> {
    if let Some(full) = Sections::decode_exact::<Vec<SavedComparisonV2>>(bytes) {
        return Some(full);
    }
    if let Some(late) = Sections::decode_exact::<Vec<SavedComparisonV1Late>>(bytes) {
        return Some(late.into_iter().map(late_to_v2).collect());
    }
    Sections::decode_exact::<Vec<SavedComparisonV1>>(bytes)
        .map(|old| old.into_iter().map(to_v2).collect())
}
