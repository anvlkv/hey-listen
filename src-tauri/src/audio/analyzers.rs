//! The analyzer catalog — the Rust-side source of truth for `list_analyzers`.
//!
//! The GUI renders the full analyzer definitions (views, per-tool param schemas,
//! help text) from the frontend store (`src/state/analyzer.ts`), which the webview
//! needs for uPlot charts. The **headless** MCP server has no webview, so it needs
//! its own list of the ids and the human metadata agents use to pick a tool.
//!
//! Keep this list in step with `src/state/analyzer.ts` (`ANALYZERS`) and
//! [`crate::audio::analysis::run`]: an id here that `run` does not know returns an
//! error, and an id `run` knows but this list omits is invisible to a headless
//! agent. The ids are the same strings the GUI uses.

/// One analyzer's agent-facing metadata (mirrors `AnalyzerDef` in the frontend,
/// minus the view/params detail the webview needs).
pub struct AnalyzerInfo {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub section: &'static str,
    pub keywords: &'static [&'static str],
}

/// Every analyzer, grouped by section, in the order the Sidebar shows them.
pub const ANALYZERS: &[AnalyzerInfo] = &[
    // Time domain
    AnalyzerInfo {
        id: "waveform",
        title: "Waveform",
        description: "Time-domain shape with peak / RMS levels",
        section: "time",
        keywords: &["waveform", "time", "envelope", "amplitude", "peak", "rms", "oscilloscope"],
    },
    AnalyzerInfo {
        id: "levels",
        title: "Level meters",
        description: "Peak and RMS level over the window",
        section: "time",
        keywords: &["level", "meter", "peak", "rms", "dbfs", "loudness", "amplitude"],
    },
    // Spectral
    AnalyzerInfo {
        id: "spectrum",
        title: "Spectrum",
        description: "Averaged FFT magnitude vs frequency",
        section: "spectral",
        keywords: &["spectrum", "fft", "frequency", "magnitude", "welch", "harmonic"],
    },
    AnalyzerInfo {
        id: "spectrogram",
        title: "Spectrogram",
        description: "STFT magnitude heatmap over time and frequency",
        section: "spectral",
        keywords: &["spectrogram", "stft", "heatmap", "time", "frequency", "waterfall"],
    },
    AnalyzerInfo {
        id: "melSpectrogram",
        title: "Mel spectrogram",
        description: "Log-mel energies over time and mel bands",
        section: "spectral",
        keywords: &["mel", "spectrogram", "perceptual", "log", "speech", "machine learning"],
    },
    AnalyzerInfo {
        id: "mfcc",
        title: "MFCC",
        description: "Mel-frequency cepstral coefficients over time",
        section: "spectral",
        keywords: &["mfcc", "cepstral", "timbre", "coefficient", "speech", "feature"],
    },
    AnalyzerInfo {
        id: "chromagram",
        title: "Chromagram",
        description: "Energy per pitch class over time",
        section: "spectral",
        keywords: &["chroma", "chromagram", "pitch class", "harmony", "chord", "key"],
    },
    AnalyzerInfo {
        id: "spectralCentroid",
        title: "Spectral centroid",
        description: "Spectral centre of mass over time",
        section: "spectral",
        keywords: &["centroid", "brightness", "timbre", "spectral", "center of mass"],
    },
    AnalyzerInfo {
        id: "spectralFlux",
        title: "Spectral flux",
        description: "Frame-to-frame spectral change (onset strength)",
        section: "spectral",
        keywords: &["flux", "onset", "transient", "novelty", "spectral change"],
    },
    AnalyzerInfo {
        id: "spectralRolloff",
        title: "Spectral rolloff",
        description: "Frequency below which most energy lies",
        section: "spectral",
        keywords: &["rolloff", "roll-off", "brightness", "energy", "high frequency"],
    },
    AnalyzerInfo {
        id: "spectralFlatness",
        title: "Spectral flatness",
        description: "Tonality vs noisiness over time",
        section: "spectral",
        keywords: &["flatness", "wiener", "entropy", "tonal", "noise", "tonality"],
    },
    AnalyzerInfo {
        id: "spectralContrast",
        title: "Spectral contrast",
        description: "Peak-to-valley ratio per octave band",
        section: "spectral",
        keywords: &["contrast", "peak", "valley", "octave", "band", "spectral"],
    },
    AnalyzerInfo {
        id: "spectralBandwidth",
        title: "Spectral bandwidth",
        description: "Spread around the spectral centroid",
        section: "spectral",
        keywords: &["bandwidth", "spread", "variance", "width", "spectral"],
    },
    AnalyzerInfo {
        id: "spectralEntropy",
        title: "Spectral entropy",
        description: "Order vs disorder of the spectrum",
        section: "spectral",
        keywords: &["entropy", "shannon", "disorder", "noise", "spectral"],
    },
    AnalyzerInfo {
        id: "spectralCrest",
        title: "Spectral crest factor",
        description: "Peak-to-average spectral power ratio",
        section: "spectral",
        keywords: &["crest", "factor", "peak", "average", "tonal", "spectral"],
    },
    AnalyzerInfo {
        id: "harmonicRatio",
        title: "Harmonic ratio",
        description: "Harmonic (periodic) content over time",
        section: "spectral",
        keywords: &["harmonic", "ratio", "hnr", "periodicity", "autocorrelation", "noise"],
    },
    AnalyzerInfo {
        id: "zeroCrossingRate",
        title: "Zero-crossing rate",
        description: "Sign-change rate over time",
        section: "spectral",
        keywords: &["zero crossing", "zcr", "sign", "voiced", "percussive", "rate"],
    },
    // Pitch / melody
    AnalyzerInfo {
        id: "pitchPyin",
        title: "Pitch (pYIN)",
        description: "Probabilistic YIN fundamental track",
        section: "pitch",
        keywords: &["pitch", "pyin", "f0", "fundamental", "melody", "viterbi"],
    },
    AnalyzerInfo {
        id: "pitchYin",
        title: "Pitch (YIN)",
        description: "YIN fundamental track",
        section: "pitch",
        keywords: &["pitch", "yin", "f0", "fundamental", "melody", "threshold"],
    },
    AnalyzerInfo {
        id: "pitchAutocorr",
        title: "Pitch (autocorrelation)",
        description: "Autocorrelation fundamental track",
        section: "pitch",
        keywords: &["pitch", "autocorrelation", "acf", "f0", "fundamental", "period"],
    },
    // Rhythm / tempo
    AnalyzerInfo {
        id: "tempo",
        title: "Tempo",
        description: "Estimated BPM and beat grid",
        section: "rhythm",
        keywords: &["tempo", "bpm", "beat", "rhythm", "pulse", "detection"],
    },
    AnalyzerInfo {
        id: "onsets",
        title: "Onsets",
        description: "Detected note / event start times",
        section: "rhythm",
        keywords: &["onset", "attack", "transient", "event", "note", "detection"],
    },
    AnalyzerInfo {
        id: "downbeats",
        title: "Downbeats",
        description: "Estimated bar-start beat times",
        section: "rhythm",
        keywords: &["downbeat", "bar", "measure", "beat", "meter", "rhythm"],
    },
    // Loudness
    AnalyzerInfo {
        id: "loudnessIntegrated",
        title: "Integrated LUFS",
        description: "EBU R128 integrated loudness",
        section: "loudness",
        keywords: &["loudness", "lufs", "ebu", "r128", "integrated", "gating", "normalization"],
    },
    AnalyzerInfo {
        id: "loudnessMomentary",
        title: "Loudness (momentary)",
        description: "Short-term loudness over time",
        section: "loudness",
        keywords: &["loudness", "momentary", "short term", "lufs", "dynamics", "level"],
    },
    AnalyzerInfo {
        id: "loudnessRange",
        title: "Loudness range",
        description: "LRA — loudness spread in LU",
        section: "loudness",
        keywords: &["loudness", "range", "lra", "dynamics", "spread", "compression"],
    },
];

/// Whether `id` names an analyzer (so a headless `run_analysis` can fail fast with a
/// helpful message instead of the engine's generic unknown-tool error).
pub fn is_analyzer(id: &str) -> bool {
    ANALYZERS.iter().any(|analyzer| analyzer.id == id)
}

/// The catalog in the shape `list_analyzers` returns (an array of objects).
pub fn list() -> Vec<serde_json::Value> {
    ANALYZERS
        .iter()
        .map(|analyzer| {
            serde_json::json!({
                "id": analyzer.id,
                "title": analyzer.title,
                "description": analyzer.description,
                "section": analyzer.section,
                "keywords": analyzer.keywords,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_covers_every_engine_tool() {
        // The engine's `run` knows these ids; the catalog must offer them all.
        for id in [
            "waveform",
            "levels",
            "spectrum",
            "spectrogram",
            "melSpectrogram",
            "mfcc",
            "chromagram",
            "spectralCentroid",
            "spectralFlux",
            "spectralRolloff",
            "spectralFlatness",
            "spectralContrast",
            "spectralBandwidth",
            "spectralEntropy",
            "spectralCrest",
            "harmonicRatio",
            "zeroCrossingRate",
            "pitchPyin",
            "pitchYin",
            "pitchAutocorr",
            "tempo",
            "onsets",
            "downbeats",
            "loudnessIntegrated",
            "loudnessMomentary",
            "loudnessRange",
        ] {
            assert!(is_analyzer(id), "catalog is missing {id}");
        }
    }

    #[test]
    fn list_is_non_empty_and_shaped() {
        let items = list();
        assert_eq!(items.len(), ANALYZERS.len());
        for item in items {
            assert!(item["id"].as_str().is_some_and(|id| !id.is_empty()));
            assert!(item["title"].as_str().is_some_and(|t| !t.is_empty()));
            assert!(item["keywords"].as_array().is_some());
        }
    }
}
