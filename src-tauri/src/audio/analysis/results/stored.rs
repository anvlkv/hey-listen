//! A `postcard`-safe mirror of [`AnalysisResult`] (M25.C).
//!
//! `AnalysisResult` is **internally tagged** (`#[serde(tag = "tool")]`) for the IPC
//! boundary. `postcard` is not self-describing and cannot deserialize that
//! representation, so a saved comparison cannot store the IPC enum directly. The
//! mirror below is an **externally tagged** enum with one newtype variant per tool:
//! postcard encodes it as a variant index plus the payload struct, and the conversions
//! are exhaustive over [`AnalysisResult`], so adding a tool cannot leave the stored
//! form behind without a compile error.
//!
//! The encoding is a project-file detail (the `COMPARE` section) and is versioned with
//! the container; it is not a public wire format.
//!
//! The same applies to a payload struct that **skips** an absent optional key:
//! `skip_serializing_if` only affects writing, while the reader still expects the field
//! (there is no "absent" marker in a non-self-describing format), so the reader runs off
//! the end of the buffer. [`SeriesResult`] (`frameSize` / `gate`) and
//! [`NoteMetricsResult`] (`syllables`) do exactly that for the JSON wire, so the stored
//! form writes their fields through the positional wrappers below.

use serde::{Deserialize, Serialize};

use super::*;

mod stored_matrix;
pub use stored_matrix::StoredMatrix;

/// The postcard-safe stored fields of a [`SeriesResult`].
///
/// Positional (postcard carries no names) and in **field order**, so a file written
/// before this wrapper — one where both optional keys happened to be present — still
/// decodes. The destructuring in the conversions below is exhaustive: adding a field to
/// `SeriesResult` fails to compile until the stored form carries it too.
type SeriesFields = (
    u32,
    usize,
    usize,
    Vec<f32>,
    f64,
    Vec<Option<f32>>,
    f32,
    f32,
    Option<usize>,
    Option<SeriesGate>,
);

/// A [`SeriesResult`] as stored in the project file (see [`SeriesFields`]).
#[derive(Clone, Serialize, Deserialize)]
pub struct StoredSeries(SeriesFields);

impl std::fmt::Debug for StoredSeries {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        SeriesResult::from(self.clone()).fmt(f)
    }
}

impl From<&SeriesResult> for StoredSeries {
    fn from(r: &SeriesResult) -> Self {
        Self((
            r.sample_rate,
            r.hop_size,
            r.frames,
            r.times.clone(),
            r.window_start,
            r.values.clone(),
            r.min_value,
            r.max_value,
            r.frame_size,
            r.gate,
        ))
    }
}

impl From<StoredSeries> for SeriesResult {
    fn from(stored: StoredSeries) -> Self {
        let (
            sample_rate,
            hop_size,
            frames,
            times,
            window_start,
            values,
            min_value,
            max_value,
            frame_size,
            gate,
        ) = stored.0;
        Self {
            sample_rate,
            hop_size,
            frames,
            times,
            window_start,
            values,
            min_value,
            max_value,
            frame_size,
            gate,
        }
    }
}

/// The postcard-safe stored fields of a [`NoteMetricsResult`] (see [`SeriesFields`]).
type NoteMetricsFields = (
    f64,
    usize,
    usize,
    f32,
    f32,
    f32,
    f32,
    f32,
    Vec<f32>,
    Option<usize>,
    Vec<NoteMetric>,
    Vec<GapMetric>,
    Option<Vec<SyllableMetric>>,
);

/// A [`NoteMetricsResult`] as stored in the project file (see [`SeriesFields`]).
#[derive(Clone, Serialize, Deserialize)]
pub struct StoredNoteMetrics(NoteMetricsFields);

impl std::fmt::Debug for StoredNoteMetrics {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        NoteMetricsResult::from(self.clone()).fmt(f)
    }
}

impl From<&NoteMetricsResult> for StoredNoteMetrics {
    fn from(r: &NoteMetricsResult) -> Self {
        Self((
            r.window_start,
            r.note_count,
            r.gap_count,
            r.total_gap_secs,
            r.longest_gap_secs,
            r.median_note_secs,
            r.median_gap_secs,
            r.threshold_db,
            r.envelope_positions.clone(),
            r.reference_note_index,
            r.notes.clone(),
            r.gaps.clone(),
            r.syllables.clone(),
        ))
    }
}

impl From<StoredNoteMetrics> for NoteMetricsResult {
    fn from(stored: StoredNoteMetrics) -> Self {
        let (
            window_start,
            note_count,
            gap_count,
            total_gap_secs,
            longest_gap_secs,
            median_note_secs,
            median_gap_secs,
            threshold_db,
            envelope_positions,
            reference_note_index,
            notes,
            gaps,
            syllables,
        ) = stored.0;
        Self {
            window_start,
            note_count,
            gap_count,
            total_gap_secs,
            longest_gap_secs,
            median_note_secs,
            median_gap_secs,
            threshold_db,
            envelope_positions,
            reference_note_index,
            notes,
            gaps,
            syllables,
        }
    }
}

/// The stored form of one analysis result (see the module note).
///
/// Variants are encoded by **index** (postcard): append a new tool at the end rather than
/// inserting one in the middle, so existing project files keep decoding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StoredAnalysisResult {
    Waveform(WaveformResult),
    Spectrum(SpectrumResult),
    Spectrogram(SpectrogramResult),
    Levels(LevelsResult),
    FrameRms(StoredSeries),
    MelSpectrogram(StoredMatrix),
    Mfcc(StoredMatrix),
    Chromagram(StoredMatrix),
    SpectralContrast(StoredMatrix),
    SpectralCentroid(StoredSeries),
    SpectralFlux(StoredSeries),
    SpectralRolloff(StoredSeries),
    SpectralFlatness(StoredSeries),
    SpectralBandwidth(StoredSeries),
    SpectralEntropy(StoredSeries),
    SpectralCrest(StoredSeries),
    HarmonicRatio(StoredSeries),
    ZeroCrossingRate(StoredSeries),
    PitchPyin(PitchResult),
    PitchYin(PitchResult),
    PitchAutocorr(PitchResult),
    NoteMetrics(StoredNoteMetrics),
    Modulation(ModulationResult),
    Tempo(RhythmResult),
    Onsets(RhythmResult),
    Downbeats(RhythmResult),
    LoudnessIntegrated(LufsResult),
    LoudnessMomentary(StoredSeries),
    LoudnessRange(LraResult),
    CriticalBands(StoredMatrix),
    Loudness(LoudnessResult),
    SpecificLoudness(StoredMatrix),
    Sharpness(CalibratedSeriesResult),
    Roughness(CalibratedSeriesResult),
    FluctuationStrength(CalibratedSeriesResult),
    Masking(MaskingResult),
    Tonality(CalibratedSeriesResult),
    Spatial(SpatialResult),
}

impl From<&AnalysisResult> for StoredAnalysisResult {
    fn from(result: &AnalysisResult) -> Self {
        match result {
            AnalysisResult::Waveform(value) => Self::Waveform(value.clone()),
            AnalysisResult::Spectrum(value) => Self::Spectrum(value.clone()),
            AnalysisResult::Spectrogram(value) => Self::Spectrogram(value.clone()),
            AnalysisResult::Levels(value) => Self::Levels(value.clone()),
            AnalysisResult::FrameRms(value) => Self::FrameRms(value.into()),
            AnalysisResult::MelSpectrogram(value) => Self::MelSpectrogram(value.into()),
            AnalysisResult::Mfcc(value) => Self::Mfcc(value.into()),
            AnalysisResult::Chromagram(value) => Self::Chromagram(value.into()),
            AnalysisResult::SpectralContrast(value) => Self::SpectralContrast(value.into()),
            AnalysisResult::SpectralCentroid(value) => Self::SpectralCentroid(value.into()),
            AnalysisResult::SpectralFlux(value) => Self::SpectralFlux(value.into()),
            AnalysisResult::SpectralRolloff(value) => Self::SpectralRolloff(value.into()),
            AnalysisResult::SpectralFlatness(value) => Self::SpectralFlatness(value.into()),
            AnalysisResult::SpectralBandwidth(value) => Self::SpectralBandwidth(value.into()),
            AnalysisResult::SpectralEntropy(value) => Self::SpectralEntropy(value.into()),
            AnalysisResult::SpectralCrest(value) => Self::SpectralCrest(value.into()),
            AnalysisResult::HarmonicRatio(value) => Self::HarmonicRatio(value.into()),
            AnalysisResult::ZeroCrossingRate(value) => Self::ZeroCrossingRate(value.into()),
            AnalysisResult::PitchPyin(value) => Self::PitchPyin(value.clone()),
            AnalysisResult::PitchYin(value) => Self::PitchYin(value.clone()),
            AnalysisResult::PitchAutocorr(value) => Self::PitchAutocorr(value.clone()),
            AnalysisResult::NoteMetrics(value) => Self::NoteMetrics(value.into()),
            AnalysisResult::Modulation(value) => Self::Modulation(value.clone()),
            AnalysisResult::Tempo(value) => Self::Tempo(value.clone()),
            AnalysisResult::Onsets(value) => Self::Onsets(value.clone()),
            AnalysisResult::Downbeats(value) => Self::Downbeats(value.clone()),
            AnalysisResult::LoudnessIntegrated(value) => Self::LoudnessIntegrated(value.clone()),
            AnalysisResult::LoudnessMomentary(value) => Self::LoudnessMomentary(value.into()),
            AnalysisResult::LoudnessRange(value) => Self::LoudnessRange(value.clone()),
            AnalysisResult::CriticalBands(value) => Self::CriticalBands(value.into()),
            AnalysisResult::Loudness(value) => Self::Loudness(value.clone()),
            AnalysisResult::SpecificLoudness(value) => Self::SpecificLoudness(value.into()),
            AnalysisResult::Sharpness(value) => Self::Sharpness(value.clone()),
            AnalysisResult::Roughness(value) => Self::Roughness(value.clone()),
            AnalysisResult::FluctuationStrength(value) => Self::FluctuationStrength(value.clone()),
            AnalysisResult::Masking(value) => Self::Masking(value.clone()),
            AnalysisResult::Tonality(value) => Self::Tonality(value.clone()),
            AnalysisResult::Spatial(value) => Self::Spatial(value.clone()),
        }
    }
}

impl From<StoredAnalysisResult> for AnalysisResult {
    fn from(stored: StoredAnalysisResult) -> Self {
        match stored {
            StoredAnalysisResult::Waveform(value) => Self::Waveform(value),
            StoredAnalysisResult::Spectrum(value) => Self::Spectrum(value),
            StoredAnalysisResult::Spectrogram(value) => Self::Spectrogram(value),
            StoredAnalysisResult::Levels(value) => Self::Levels(value),
            StoredAnalysisResult::FrameRms(value) => Self::FrameRms(value.into()),
            StoredAnalysisResult::MelSpectrogram(value) => Self::MelSpectrogram(value.into()),
            StoredAnalysisResult::Mfcc(value) => Self::Mfcc(value.into()),
            StoredAnalysisResult::Chromagram(value) => Self::Chromagram(value.into()),
            StoredAnalysisResult::SpectralContrast(value) => Self::SpectralContrast(value.into()),
            StoredAnalysisResult::SpectralCentroid(value) => Self::SpectralCentroid(value.into()),
            StoredAnalysisResult::SpectralFlux(value) => Self::SpectralFlux(value.into()),
            StoredAnalysisResult::SpectralRolloff(value) => Self::SpectralRolloff(value.into()),
            StoredAnalysisResult::SpectralFlatness(value) => Self::SpectralFlatness(value.into()),
            StoredAnalysisResult::SpectralBandwidth(value) => Self::SpectralBandwidth(value.into()),
            StoredAnalysisResult::SpectralEntropy(value) => Self::SpectralEntropy(value.into()),
            StoredAnalysisResult::SpectralCrest(value) => Self::SpectralCrest(value.into()),
            StoredAnalysisResult::HarmonicRatio(value) => Self::HarmonicRatio(value.into()),
            StoredAnalysisResult::ZeroCrossingRate(value) => Self::ZeroCrossingRate(value.into()),
            StoredAnalysisResult::PitchPyin(value) => Self::PitchPyin(value),
            StoredAnalysisResult::PitchYin(value) => Self::PitchYin(value),
            StoredAnalysisResult::PitchAutocorr(value) => Self::PitchAutocorr(value),
            StoredAnalysisResult::NoteMetrics(value) => Self::NoteMetrics(value.into()),
            StoredAnalysisResult::Modulation(value) => Self::Modulation(value),
            StoredAnalysisResult::Tempo(value) => Self::Tempo(value),
            StoredAnalysisResult::Onsets(value) => Self::Onsets(value),
            StoredAnalysisResult::Downbeats(value) => Self::Downbeats(value),
            StoredAnalysisResult::LoudnessIntegrated(value) => Self::LoudnessIntegrated(value),
            StoredAnalysisResult::LoudnessMomentary(value) => Self::LoudnessMomentary(value.into()),
            StoredAnalysisResult::LoudnessRange(value) => Self::LoudnessRange(value),
            StoredAnalysisResult::CriticalBands(value) => Self::CriticalBands(value.into()),
            StoredAnalysisResult::Loudness(value) => Self::Loudness(value),
            StoredAnalysisResult::SpecificLoudness(value) => Self::SpecificLoudness(value.into()),
            StoredAnalysisResult::Sharpness(value) => Self::Sharpness(value),
            StoredAnalysisResult::Roughness(value) => Self::Roughness(value),
            StoredAnalysisResult::FluctuationStrength(value) => Self::FluctuationStrength(value),
            StoredAnalysisResult::Masking(value) => Self::Masking(value),
            StoredAnalysisResult::Tonality(value) => Self::Tonality(value),
            StoredAnalysisResult::Spatial(value) => Self::Spatial(value),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::fixtures;

    fn round_trip(result: &AnalysisResult) -> AnalysisResult {
        let bytes = postcard::to_stdvec(&StoredAnalysisResult::from(result)).expect("encode");
        postcard::from_bytes::<StoredAnalysisResult>(&bytes)
            .expect("decode")
            .into()
    }

    fn assert_same(a: &AnalysisResult, b: &AnalysisResult) {
        assert_eq!(
            serde_json::to_value(b).expect("json"),
            serde_json::to_value(a).expect("json"),
            "{:?} did not survive the stored form",
            a.tool_id()
        );
    }

    #[test]
    fn every_result_variant_round_trips_through_postcard() {
        // The fixtures cover the common case: a series with `frameSize` absent, and a
        // note list with `syllables` absent — the fields the JSON wire skips.
        for result in fixtures::samples() {
            assert_same(&result, &round_trip(&result));
        }
    }

    #[test]
    fn present_optional_keys_round_trip_through_postcard() {
        let gated = SeriesResult {
            gate: Some(SeriesGate {
                gate_db: 20.0,
                gate_floor_db: -120.0,
                threshold_db: -26.0,
                gated_frames: 1,
                kept_frames: 3,
            }),
            ..fixtures::series()
        };
        let grouped = NoteMetricsResult {
            syllables: Some(vec![SyllableMetric {
                start_secs: 0.4,
                end_secs: 0.8,
                duration_secs: 0.4,
                note_count: 1,
                rms_db: -18.0,
                peak_db: -9.0,
            }]),
            ..fixtures::notes()
        };
        for result in [
            AnalysisResult::FrameRms(gated),
            AnalysisResult::LoudnessMomentary(fixtures::frame_rms()),
            AnalysisResult::NoteMetrics(grouped),
        ] {
            assert_same(&result, &round_trip(&result));
        }
    }
}
