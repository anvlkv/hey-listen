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
        | AnalyzerId::CriticalBands => MATRIX,
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
