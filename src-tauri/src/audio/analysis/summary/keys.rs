//! The summary item keys each result family reports (M21), and the tool → family
//! map an agent discovers through `get_analyzer`.

use crate::audio::analyzers::AnalyzerId;

// Item-key lists, one per family. `summary_keys` maps a tool id onto one of these.
const WAVEFORM: &[&str] = &["peakDb", "rmsDb", "duration"];
const SPECTRUM: &[&str] = &["peakHz", "peakDb", "fftSize", "hopSize", "frames"];
const SPECTROGRAM: &[&str] = &["frames", "bins", "duration", "peakTime", "peakHz", "peakDb"];
const MATRIX: &[&str] = &[
    "frames",
    "bands",
    "duration",
    "peakFrame",
    "peakBand",
    "peakValue",
    "peakTime",
];
const SERIES: &[&str] = &[
    "frames",
    "min",
    "max",
    "minTime",
    "maxTime",
    "gateDb",
    "gateFloorDb",
    "gateThresholdDb",
    "gatedFrames",
    "keptFrames",
];
const FRAME_RMS: &[&str] = &[
    "minDb",
    "maxDb",
    "meanDb",
    "frameSize",
    "hopSize",
    "frames",
    "gateDb",
    "gateFloorDb",
    "gateThresholdDb",
    "gatedFrames",
    "keptFrames",
];
const PITCH: &[&str] = &[
    "frames",
    "medianF0Hz",
    "meanF0Hz",
    "voicedFrames",
    "voicedFraction",
    "f0Reliable",
    "effectiveMinF0Hz",
    "effectiveMaxF0Hz",
];
const RHYTHM: &[&str] = &[
    "bpm",
    "confidence",
    "onsetCount",
    "beatCount",
    "downbeatCount",
    "firstEvent",
    "lastEvent",
    "strongestOnset",
];
const NOTES: &[&str] = &[
    "noteCount",
    "gapCount",
    "totalGap",
    "longestGap",
    "medianNote",
    "thresholdDb",
    "loudestNoteDb",
    "loudestNoteTime",
    "syllableCount",
];
const MODULATION: &[&str] = &[
    "amRateHz",
    "amDepth",
    "amPeakToTroughDb",
    "fmRateHz",
    "fmPeakToPeakCents",
    "fmRunSecs",
    "fmReliable",
    "voicedFraction",
];

/// The Moore–Glasberg loudness summary (M27): the sone N5 / mean / max, the N5 in
/// phons, and the calibration state.
const LOUDNESS: &[&str] = &[
    "frames",
    "n5Sone",
    "meanSone",
    "maxSone",
    "n5Phon",
    "calibrated",
    "calibrationDbSpl",
];

/// The summary item keys a calibrated scalar series reports (M28): the value
/// extents over the track plus the calibration state.
const CALIBRATED_SERIES: &[&str] = &[
    "frames",
    "min",
    "max",
    "minTime",
    "maxTime",
    "calibrated",
    "calibrationDbSpl",
];

/// The spectrum plus its masking threshold (M30): the grid, the SMR extents, and the
/// calibration state.
const MASKING: &[&str] = &[
    "fftSize",
    "frames",
    "minSmrDb",
    "maxSmrDb",
    "calibrated",
    "calibrationDbSpl",
];

/// The summary item keys `tool` produces. Analyzers that are not listed fall back to
/// the generic series shape (every scalar-per-frame tool).
pub fn summary_keys(tool: AnalyzerId) -> &'static [&'static str] {
    match tool {
        AnalyzerId::Waveform | AnalyzerId::Levels => WAVEFORM,
        AnalyzerId::Spectrum => SPECTRUM,
        AnalyzerId::Spectrogram => SPECTROGRAM,
        AnalyzerId::MelSpectrogram
        | AnalyzerId::Mfcc
        | AnalyzerId::Chromagram
        | AnalyzerId::SpectralContrast
        | AnalyzerId::CriticalBands
        | AnalyzerId::SpecificLoudness => MATRIX,
        AnalyzerId::Loudness => LOUDNESS,
        AnalyzerId::Sharpness | AnalyzerId::Roughness | AnalyzerId::FluctuationStrength => {
            CALIBRATED_SERIES
        }
        AnalyzerId::Tonality => CALIBRATED_SERIES,
        AnalyzerId::Masking => MASKING,
        AnalyzerId::FrameRms => FRAME_RMS,
        AnalyzerId::PitchPyin | AnalyzerId::PitchYin | AnalyzerId::PitchAutocorr => PITCH,
        AnalyzerId::NoteMetrics => NOTES,
        AnalyzerId::Modulation => MODULATION,
        AnalyzerId::Tempo | AnalyzerId::Onsets | AnalyzerId::Downbeats => RHYTHM,
        AnalyzerId::LoudnessIntegrated => &["lufs"],
        AnalyzerId::LoudnessRange => &["lra"],
        AnalyzerId::SpectralCentroid
        | AnalyzerId::SpectralFlux
        | AnalyzerId::SpectralRolloff
        | AnalyzerId::SpectralFlatness
        | AnalyzerId::SpectralBandwidth
        | AnalyzerId::SpectralEntropy
        | AnalyzerId::SpectralCrest
        | AnalyzerId::HarmonicRatio
        | AnalyzerId::ZeroCrossingRate
        | AnalyzerId::LoudnessMomentary => SERIES,
    }
}
