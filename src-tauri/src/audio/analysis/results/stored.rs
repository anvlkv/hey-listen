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

use serde::{Deserialize, Serialize};

use super::*;

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
    FrameRms(SeriesResult),
    MelSpectrogram(MatrixResult),
    Mfcc(MatrixResult),
    Chromagram(MatrixResult),
    SpectralContrast(MatrixResult),
    SpectralCentroid(SeriesResult),
    SpectralFlux(SeriesResult),
    SpectralRolloff(SeriesResult),
    SpectralFlatness(SeriesResult),
    SpectralBandwidth(SeriesResult),
    SpectralEntropy(SeriesResult),
    SpectralCrest(SeriesResult),
    HarmonicRatio(SeriesResult),
    ZeroCrossingRate(SeriesResult),
    PitchPyin(PitchResult),
    PitchYin(PitchResult),
    PitchAutocorr(PitchResult),
    NoteMetrics(NoteMetricsResult),
    Modulation(ModulationResult),
    Tempo(RhythmResult),
    Onsets(RhythmResult),
    Downbeats(RhythmResult),
    LoudnessIntegrated(LufsResult),
    LoudnessMomentary(SeriesResult),
    LoudnessRange(LraResult),
}

impl From<&AnalysisResult> for StoredAnalysisResult {
    fn from(result: &AnalysisResult) -> Self {
        match result {
            AnalysisResult::Waveform(value) => Self::Waveform(value.clone()),
            AnalysisResult::Spectrum(value) => Self::Spectrum(value.clone()),
            AnalysisResult::Spectrogram(value) => Self::Spectrogram(value.clone()),
            AnalysisResult::Levels(value) => Self::Levels(value.clone()),
            AnalysisResult::FrameRms(value) => Self::FrameRms(value.clone()),
            AnalysisResult::MelSpectrogram(value) => Self::MelSpectrogram(value.clone()),
            AnalysisResult::Mfcc(value) => Self::Mfcc(value.clone()),
            AnalysisResult::Chromagram(value) => Self::Chromagram(value.clone()),
            AnalysisResult::SpectralContrast(value) => Self::SpectralContrast(value.clone()),
            AnalysisResult::SpectralCentroid(value) => Self::SpectralCentroid(value.clone()),
            AnalysisResult::SpectralFlux(value) => Self::SpectralFlux(value.clone()),
            AnalysisResult::SpectralRolloff(value) => Self::SpectralRolloff(value.clone()),
            AnalysisResult::SpectralFlatness(value) => Self::SpectralFlatness(value.clone()),
            AnalysisResult::SpectralBandwidth(value) => Self::SpectralBandwidth(value.clone()),
            AnalysisResult::SpectralEntropy(value) => Self::SpectralEntropy(value.clone()),
            AnalysisResult::SpectralCrest(value) => Self::SpectralCrest(value.clone()),
            AnalysisResult::HarmonicRatio(value) => Self::HarmonicRatio(value.clone()),
            AnalysisResult::ZeroCrossingRate(value) => Self::ZeroCrossingRate(value.clone()),
            AnalysisResult::PitchPyin(value) => Self::PitchPyin(value.clone()),
            AnalysisResult::PitchYin(value) => Self::PitchYin(value.clone()),
            AnalysisResult::PitchAutocorr(value) => Self::PitchAutocorr(value.clone()),
            AnalysisResult::NoteMetrics(value) => Self::NoteMetrics(value.clone()),
            AnalysisResult::Modulation(value) => Self::Modulation(value.clone()),
            AnalysisResult::Tempo(value) => Self::Tempo(value.clone()),
            AnalysisResult::Onsets(value) => Self::Onsets(value.clone()),
            AnalysisResult::Downbeats(value) => Self::Downbeats(value.clone()),
            AnalysisResult::LoudnessIntegrated(value) => Self::LoudnessIntegrated(value.clone()),
            AnalysisResult::LoudnessMomentary(value) => Self::LoudnessMomentary(value.clone()),
            AnalysisResult::LoudnessRange(value) => Self::LoudnessRange(value.clone()),
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
            StoredAnalysisResult::FrameRms(value) => Self::FrameRms(value),
            StoredAnalysisResult::MelSpectrogram(value) => Self::MelSpectrogram(value),
            StoredAnalysisResult::Mfcc(value) => Self::Mfcc(value),
            StoredAnalysisResult::Chromagram(value) => Self::Chromagram(value),
            StoredAnalysisResult::SpectralContrast(value) => Self::SpectralContrast(value),
            StoredAnalysisResult::SpectralCentroid(value) => Self::SpectralCentroid(value),
            StoredAnalysisResult::SpectralFlux(value) => Self::SpectralFlux(value),
            StoredAnalysisResult::SpectralRolloff(value) => Self::SpectralRolloff(value),
            StoredAnalysisResult::SpectralFlatness(value) => Self::SpectralFlatness(value),
            StoredAnalysisResult::SpectralBandwidth(value) => Self::SpectralBandwidth(value),
            StoredAnalysisResult::SpectralEntropy(value) => Self::SpectralEntropy(value),
            StoredAnalysisResult::SpectralCrest(value) => Self::SpectralCrest(value),
            StoredAnalysisResult::HarmonicRatio(value) => Self::HarmonicRatio(value),
            StoredAnalysisResult::ZeroCrossingRate(value) => Self::ZeroCrossingRate(value),
            StoredAnalysisResult::PitchPyin(value) => Self::PitchPyin(value),
            StoredAnalysisResult::PitchYin(value) => Self::PitchYin(value),
            StoredAnalysisResult::PitchAutocorr(value) => Self::PitchAutocorr(value),
            StoredAnalysisResult::NoteMetrics(value) => Self::NoteMetrics(value),
            StoredAnalysisResult::Modulation(value) => Self::Modulation(value),
            StoredAnalysisResult::Tempo(value) => Self::Tempo(value),
            StoredAnalysisResult::Onsets(value) => Self::Onsets(value),
            StoredAnalysisResult::Downbeats(value) => Self::Downbeats(value),
            StoredAnalysisResult::LoudnessIntegrated(value) => Self::LoudnessIntegrated(value),
            StoredAnalysisResult::LoudnessMomentary(value) => Self::LoudnessMomentary(value),
            StoredAnalysisResult::LoudnessRange(value) => Self::LoudnessRange(value),
        }
    }
}
