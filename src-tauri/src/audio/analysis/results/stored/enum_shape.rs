//! One definition of the stored-result variant list.
//!
//! `StoredAnalysisResult` and the frozen version-3 mirror
//! (`project::migrate::v3::StoredAnalysisResultV3`) must list the same variants in the
//! same order — postcard encodes a variant by **index** — so the list lives here once and
//! both enums are generated from it. Only the payload types of the matrix and
//! calibrated-series tools differ between the two versions; they are passed in.

/// Define a stored-result enum with the shared variant order. `$matrix` / `$series` are
/// the payload types for the matrix and calibrated-series tools.
#[macro_export]
#[doc(hidden)]
macro_rules! stored_result_enum {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            matrix = $matrix:ty,
            series = $series:ty,
        }
    ) => {
        $(#[$meta])*
        $vis enum $name {
            Waveform($crate::audio::analysis::StoredWaveform),
            Spectrum($crate::audio::analysis::SpectrumResult),
            Spectrogram($crate::audio::analysis::SpectrogramResult),
            Levels($crate::audio::analysis::LevelsResult),
            FrameRms($crate::audio::analysis::StoredSeries),
            MelSpectrogram($matrix),
            Mfcc($matrix),
            Chromagram($matrix),
            SpectralContrast($matrix),
            SpectralCentroid($crate::audio::analysis::StoredSeries),
            SpectralFlux($crate::audio::analysis::StoredSeries),
            SpectralRolloff($crate::audio::analysis::StoredSeries),
            SpectralFlatness($crate::audio::analysis::StoredSeries),
            SpectralBandwidth($crate::audio::analysis::StoredSeries),
            SpectralEntropy($crate::audio::analysis::StoredSeries),
            SpectralCrest($crate::audio::analysis::StoredSeries),
            HarmonicRatio($crate::audio::analysis::StoredSeries),
            ZeroCrossingRate($crate::audio::analysis::StoredSeries),
            PitchPyin($crate::audio::analysis::StoredPitch),
            PitchYin($crate::audio::analysis::StoredPitch),
            PitchAutocorr($crate::audio::analysis::StoredPitch),
            NoteMetrics($crate::audio::analysis::StoredNoteMetrics),
            Modulation($crate::audio::analysis::ModulationResult),
            Tempo($crate::audio::analysis::RhythmResult),
            Onsets($crate::audio::analysis::RhythmResult),
            Downbeats($crate::audio::analysis::RhythmResult),
            LoudnessIntegrated($crate::audio::analysis::LufsResult),
            LoudnessMomentary($crate::audio::analysis::StoredSeries),
            LoudnessRange($crate::audio::analysis::LraResult),
            CriticalBands($matrix),
            Loudness($crate::audio::analysis::StoredLoudness),
            SpecificLoudness($matrix),
            Sharpness($series),
            Roughness($series),
            FluctuationStrength($series),
            Masking($crate::audio::analysis::StoredMasking),
            Tonality($series),
            Spatial($crate::audio::analysis::SpatialResult),
        }
    };
}
