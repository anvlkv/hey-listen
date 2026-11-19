//! Version 5 → 6: `ModulationResult` gains a trailing per-note `notes` field (D-18).
//!
//! `postcard` is positional and the result is **nested** inside a `SavedComparison`
//! (snapshot fields follow it), so a version-5 modulation result would read the
//! snapshot's next fields as `notes`. The step therefore decodes `COMPARE` with a frozen
//! mirror of the version-5 shapes and re-encodes the current ones, so a saved comparison
//! survives the hop with an empty per-note list.
//!
//! `RESULTS` is a cache and `run_with` drops it for every pre-`VERSION` file (it is never
//! migrated); the step's own drop only fires when it is applied on its own. `SOURCE`,
//! `DATA`, `SETUP`, `LAYOUT` and `ANNOTATIONS` pass through untouched.
//!
//! The frozen types are **release snapshots**: never edit them.

use serde::{Deserialize, Serialize};

use crate::audio::analysis::compare::{SavedComparison, SourceShape, Span};
use crate::audio::analysis::{
    LevelsResult, LraResult, LufsResult, ModulationPeak, ModulationResult, RhythmResult,
    SharedParams, SpatialResult, SpectrogramResult, SpectrumResult, StoredAnalysisResult,
    StoredCalibratedSeries, StoredLoudness, StoredMasking, StoredMatrix, StoredNoteMetrics,
    StoredPitch, StoredSeries, StoredWaveform, ToolOptions,
};
use crate::audio::analyzers::AnalyzerId;
use crate::project::ProjectError;

use super::{frozen_saved_comparison, DroppedSection, Sections};

/// [`ModulationResult`] as version 5 wrote it (everything before `notes`).
#[derive(Serialize, Deserialize)]
pub(super) struct ModulationResultV5 {
    window_start: f64,
    effective_mod_min_hz: f32,
    effective_mod_max_hz: f32,
    mod_freqs: Vec<f32>,
    am_db: Vec<f32>,
    fm_db: Vec<f32>,
    am_peaks: Vec<ModulationPeak>,
    fm_peaks: Vec<ModulationPeak>,
    am_depth: Option<f32>,
    am_peak_to_trough_db: Option<f32>,
    fm_run_start_secs: Option<f32>,
    fm_run_end_secs: Option<f32>,
    fm_rate_hz: Option<f32>,
    fm_peak_to_peak_cents: Option<f32>,
    fm_std_cents: Option<f32>,
    fm_reliable: bool,
    voiced_fraction: f32,
}

impl From<ModulationResultV5> for ModulationResult {
    fn from(old: ModulationResultV5) -> Self {
        Self {
            window_start: old.window_start,
            effective_mod_min_hz: old.effective_mod_min_hz,
            effective_mod_max_hz: old.effective_mod_max_hz,
            mod_freqs: old.mod_freqs,
            am_db: old.am_db,
            fm_db: old.fm_db,
            am_peaks: old.am_peaks,
            fm_peaks: old.fm_peaks,
            am_depth: old.am_depth,
            am_peak_to_trough_db: old.am_peak_to_trough_db,
            fm_run_start_secs: old.fm_run_start_secs,
            fm_run_end_secs: old.fm_run_end_secs,
            fm_rate_hz: old.fm_rate_hz,
            fm_peak_to_peak_cents: old.fm_peak_to_peak_cents,
            fm_std_cents: old.fm_std_cents,
            fm_reliable: old.fm_reliable,
            voiced_fraction: old.voiced_fraction,
            // Version 5 had no per-note analysis.
            notes: Vec::new(),
        }
    }
}

/// [`StoredAnalysisResult`] as version 5 wrote it: every variant is unchanged except
/// `Modulation`, whose payload is frozen above. Variant **order** is the wire format, so
/// it matches the current enum exactly.
#[derive(Serialize, Deserialize)]
pub(super) enum StoredAnalysisResultV5 {
    Waveform(StoredWaveform),
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
    PitchPyin(StoredPitch),
    PitchYin(StoredPitch),
    PitchAutocorr(StoredPitch),
    NoteMetrics(StoredNoteMetrics),
    Modulation(ModulationResultV5),
    Tempo(RhythmResult),
    Onsets(RhythmResult),
    Downbeats(RhythmResult),
    LoudnessIntegrated(LufsResult),
    LoudnessMomentary(StoredSeries),
    LoudnessRange(LraResult),
    CriticalBands(StoredMatrix),
    Loudness(StoredLoudness),
    SpecificLoudness(StoredMatrix),
    Sharpness(StoredCalibratedSeries),
    Roughness(StoredCalibratedSeries),
    FluctuationStrength(StoredCalibratedSeries),
    Masking(StoredMasking),
    Tonality(StoredCalibratedSeries),
    Spatial(SpatialResult),
}

impl From<StoredAnalysisResultV5> for StoredAnalysisResult {
    fn from(old: StoredAnalysisResultV5) -> Self {
        use StoredAnalysisResultV5 as V5;
        match old {
            V5::Waveform(value) => Self::Waveform(value),
            V5::Spectrum(value) => Self::Spectrum(value),
            V5::Spectrogram(value) => Self::Spectrogram(value),
            V5::Levels(value) => Self::Levels(value),
            V5::FrameRms(value) => Self::FrameRms(value),
            V5::MelSpectrogram(value) => Self::MelSpectrogram(value),
            V5::Mfcc(value) => Self::Mfcc(value),
            V5::Chromagram(value) => Self::Chromagram(value),
            V5::SpectralContrast(value) => Self::SpectralContrast(value),
            V5::SpectralCentroid(value) => Self::SpectralCentroid(value),
            V5::SpectralFlux(value) => Self::SpectralFlux(value),
            V5::SpectralRolloff(value) => Self::SpectralRolloff(value),
            V5::SpectralFlatness(value) => Self::SpectralFlatness(value),
            V5::SpectralBandwidth(value) => Self::SpectralBandwidth(value),
            V5::SpectralEntropy(value) => Self::SpectralEntropy(value),
            V5::SpectralCrest(value) => Self::SpectralCrest(value),
            V5::HarmonicRatio(value) => Self::HarmonicRatio(value),
            V5::ZeroCrossingRate(value) => Self::ZeroCrossingRate(value),
            V5::PitchPyin(value) => Self::PitchPyin(value),
            V5::PitchYin(value) => Self::PitchYin(value),
            V5::PitchAutocorr(value) => Self::PitchAutocorr(value),
            V5::NoteMetrics(value) => Self::NoteMetrics(value),
            V5::Modulation(value) => Self::Modulation(value.into()),
            V5::Tempo(value) => Self::Tempo(value),
            V5::Onsets(value) => Self::Onsets(value),
            V5::Downbeats(value) => Self::Downbeats(value),
            V5::LoudnessIntegrated(value) => Self::LoudnessIntegrated(value),
            V5::LoudnessMomentary(value) => Self::LoudnessMomentary(value),
            V5::LoudnessRange(value) => Self::LoudnessRange(value),
            V5::CriticalBands(value) => Self::CriticalBands(value),
            V5::Loudness(value) => Self::Loudness(value),
            V5::SpecificLoudness(value) => Self::SpecificLoudness(value),
            V5::Sharpness(value) => Self::Sharpness(value),
            V5::Roughness(value) => Self::Roughness(value),
            V5::FluctuationStrength(value) => Self::FluctuationStrength(value),
            V5::Masking(value) => Self::Masking(value),
            V5::Tonality(value) => Self::Tonality(value),
            V5::Spatial(value) => Self::Spatial(value),
        }
    }
}

/// [`SavedComparison`] as version 5 wrote it.
#[derive(Serialize, Deserialize)]
pub(super) struct SavedComparisonV5 {
    pub tool: AnalyzerId,
    pub reference_name: String,
    pub source: SourceShape,
    pub window: Span,
    pub params: SharedParams,
    pub options: ToolOptions,
    pub filter_fingerprint: Option<String>,
    pub b_offset: f64,
    pub saved_ms: u64,
    pub result: StoredAnalysisResultV5,
    pub reference_path: Option<String>,
    pub id: String,
    pub owner_window: Span,
    pub owner_channel: Option<usize>,
}

frozen_saved_comparison!(SavedComparisonV5);

pub(super) fn from_v5_to_v6(sections: &mut Sections) -> Result<(), ProjectError> {
    // Defensive: `run_with` takes the cache before the steps run, so this normally finds
    // nothing. A step applied on its own still reports the drop honestly.
    if sections.results.take().is_some() {
        sections.dropped.push(DroppedSection::Results);
    }
    if let Some(bytes) = sections.compare.as_deref() {
        // A current payload under a v5 header (a re-save from a test or a pre-release
        // build) is accepted unchanged, so the step can never reject a file it has
        // already migrated once.
        let snapshots = Sections::decode_exact::<Vec<SavedComparisonV5>>(bytes)
            .map(|old| {
                old.into_iter()
                    .map(SavedComparison::from)
                    .collect::<Vec<_>>()
            })
            .or_else(|| Sections::decode_exact::<Vec<SavedComparison>>(bytes));
        sections.replace_compare(
            snapshots,
            "dropping the saved comparisons (no known version 5 layout)",
        )?;
    }
    sections.version += 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A version-5 modulation result: no spectra content needed, only the shape.
    fn v5_modulation_result() -> ModulationResultV5 {
        ModulationResultV5 {
            window_start: 1.0,
            effective_mod_min_hz: 0.5,
            effective_mod_max_hz: 100.0,
            mod_freqs: vec![1.0, 2.0],
            am_db: vec![0.0, -6.0],
            fm_db: vec![],
            am_peaks: vec![ModulationPeak {
                rate_hz: 1.0,
                relative_db: 0.0,
                prominence_db: 3.0,
            }],
            fm_peaks: vec![],
            am_depth: Some(0.4),
            am_peak_to_trough_db: Some(6.0),
            fm_run_start_secs: None,
            fm_run_end_secs: None,
            fm_rate_hz: None,
            fm_peak_to_peak_cents: None,
            fm_std_cents: None,
            fm_reliable: false,
            voiced_fraction: 0.0,
        }
    }

    fn v5_snapshot() -> SavedComparisonV5 {
        SavedComparisonV5 {
            tool: AnalyzerId::Modulation,
            reference_name: "ref".to_string(),
            source: SourceShape {
                sample_rate: 48_000,
                channels: 1,
                duration: 3.0,
            },
            window: Span {
                start: 1.0,
                end: 2.0,
            },
            params: SharedParams::default(),
            options: ToolOptions::default(),
            filter_fingerprint: None,
            b_offset: 0.0,
            saved_ms: 7,
            result: StoredAnalysisResultV5::Modulation(v5_modulation_result()),
            reference_path: Some("/tmp/ref.heyl".to_string()),
            id: "cmp-1".to_string(),
            owner_window: Span {
                start: 0.0,
                end: 3.0,
            },
            owner_channel: None,
        }
    }

    #[test]
    fn a_version_5_modulation_snapshot_gains_an_empty_per_note_list() {
        let mut sections = Sections {
            version: 5,
            compare: Some(Sections::encode(&vec![v5_snapshot()]).expect("compare")),
            ..Sections::default()
        };

        from_v5_to_v6(&mut sections).expect("migrate");
        assert_eq!(sections.version, 6);
        assert!(sections.dropped.is_empty(), "nothing is dropped");

        let compare = sections.compare.expect("the comparison survives");
        let snapshots = Sections::decode_exact::<Vec<SavedComparison>>(&compare)
            .expect("the current layout decodes exactly");
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].id, "cmp-1");
        assert_eq!(
            snapshots[0].reference_path.as_deref(),
            Some("/tmp/ref.heyl")
        );
        match &snapshots[0].result {
            StoredAnalysisResult::Modulation(result) => {
                assert!(
                    result.notes.is_empty(),
                    "version 5 had no per-note analysis"
                );
                assert_eq!(result.am_peaks.len(), 1);
                assert_eq!(result.am_depth, Some(0.4));
            }
            _ => panic!("the modulation variant is preserved"),
        }
    }
}
