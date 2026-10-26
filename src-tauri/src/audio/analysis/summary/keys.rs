//! The summary item keys each result family reports (M21), and the tool → family
//! map an agent discovers through `get_analyzer`.

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
pub fn summary_keys(tool: &str) -> &'static [&'static str] {
    match tool {
        "waveform" | "levels" => WAVEFORM,
        "spectrum" => SPECTRUM,
        "spectrogram" => SPECTROGRAM,
        "melSpectrogram" | "mfcc" | "chromagram" | "spectralContrast" => MATRIX,
        "frameRms" => FRAME_RMS,
        "pitchPyin" | "pitchYin" | "pitchAutocorr" => PITCH,
        "noteMetrics" => NOTES,
        "modulation" => MODULATION,
        "tempo" | "onsets" | "downbeats" => RHYTHM,
        "loudnessIntegrated" => &["lufs"],
        "loudnessRange" => &["lra"],
        _ => SERIES,
    }
}
