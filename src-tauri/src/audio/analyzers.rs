//! The analyzer catalog — the Rust-side source of truth for `list_analyzers`.
//!
//! The GUI renders the full analyzer definitions (views, per-tool param schemas,
//! help text) from the frontend store (`src/state/analyzer/`), which the webview
//! needs for uPlot charts. The **headless** MCP server has no webview, so it needs
//! its own list of the ids and the human metadata agents use to pick a tool.
//!
//! Keep this list in step with `src/state/analyzer/defs/` (`ANALYZERS`) and
//! [`crate::audio::analysis::run`]: an id here that `run` does not know returns an
//! error, and an id `run` knows but this list omits is invisible to a headless
//! agent. The ids are the same strings the GUI uses.
//!
//! The catalog data lives in [`catalog`]; the option metadata and the
//! `list_analyzers` payload live here.

mod catalog;

/// One analyzer's agent-facing metadata (mirrors `AnalyzerDef` in the frontend,
/// minus the view/params detail the webview needs).
pub struct AnalyzerInfo {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub section: &'static str,
    pub keywords: &'static [&'static str],
}

/// One per-tool **engine** option's metadata. `list_analyzers` carries the compact
/// keys + defaults; the remaining fields are the full detail M21's `get_analyzer`
/// returns, kept here so the catalog stays the one source of truth.
#[allow(dead_code)] // the descriptive fields are read by `get_analyzer` (M21)
pub struct OptionInfo {
    /// Canonical camelCase key (matching `ToolOptions`).
    pub key: &'static str,
    pub label: &'static str,
    pub default: f64,
    pub min: f64,
    pub max: f64,
    pub help: &'static str,
}

/// Every analyzer, grouped by section, in the order the Sidebar shows them.
pub const ANALYZERS: &[AnalyzerInfo] = catalog::ANALYZERS;

/// Per-analyzer engine-option metadata, keyed by analyzer id. Analyzers without
/// their own options are absent (the `list_analyzers` option map is then empty).
const OPTIONS: &[(&str, &[OptionInfo])] = &[
    (
        "frameRms",
        &[
            OptionInfo {
                key: "frameMs",
                label: "Frame",
                default: 10.0,
                min: 0.1,
                max: 1_000.0,
                help: "RMS frame length in ms — the envelope's time smoothing.",
            },
            OptionInfo {
                key: "hopMs",
                label: "Hop",
                default: 5.0,
                min: 0.05,
                max: 1_000.0,
                help: "Step between frames in ms; smaller values give a denser envelope.",
            },
        ],
    ),
    (
        "melSpectrogram",
        &[OptionInfo {
            key: "nMels",
            label: "Mel bands",
            default: 64.0,
            min: 8.0,
            max: 256.0,
            help: "Number of mel bands; more bands give finer frequency detail.",
        }],
    ),
    (
        "mfcc",
        &[
            OptionInfo {
                key: "nMfcc",
                label: "Coefficients",
                default: 13.0,
                min: 1.0,
                max: 64.0,
                help: "Cepstral coefficients (rows); ~13 captures the spectral envelope.",
            },
            OptionInfo {
                key: "nMels",
                label: "Mel bands",
                default: 64.0,
                min: 8.0,
                max: 256.0,
                help: "Mel bands fed to the cepstral transform.",
            },
        ],
    ),
    (
        "spectralRolloff",
        &[OptionInfo {
            key: "rolloffPercent",
            label: "Energy share",
            default: 0.85,
            min: 0.01,
            max: 0.99,
            help: "Share of spectral energy below the rolloff frequency.",
        }],
    ),
    (
        "spectralContrast",
        &[OptionInfo {
            key: "nBands",
            label: "Bands",
            default: 6.0,
            min: 2.0,
            max: 16.0,
            help: "Number of octave-spaced bands compared peak-to-valley.",
        }],
    ),
    (
        "harmonicRatio",
        &[
            OptionInfo {
                key: "minF0Hz",
                label: "Min f0",
                default: 50.0,
                min: 20.0,
                max: 4_000.0,
                help: "Lowest expected fundamental — the bottom of the autocorrelation search.",
            },
            OptionInfo {
                key: "maxF0Hz",
                label: "Max f0",
                default: 4_000.0,
                min: 40.0,
                max: 8_000.0,
                help: "Highest expected fundamental — the top of the autocorrelation search.",
            },
        ],
    ),
    (
        "pitchYin",
        &[
            OptionInfo {
                key: "yinThreshold",
                label: "YIN threshold",
                default: 0.12,
                min: 0.01,
                max: 0.9,
                help: "Voiced/unvoiced threshold; lower is stricter.",
            },
            OptionInfo {
                key: "minF0Hz",
                label: "Min f0",
                default: 50.0,
                min: 20.0,
                max: 5_000.0,
                help: "Lowest expected fundamental — the bottom of the YIN search.",
            },
            OptionInfo {
                key: "maxF0Hz",
                label: "Max f0",
                default: 2_000.0,
                min: 40.0,
                max: 8_000.0,
                help: "Highest expected fundamental — YIN can search above 2 kHz.",
            },
        ],
    ),
    (
        "pitchAutocorr",
        &[
            OptionInfo {
                key: "minF0Hz",
                label: "Min f0",
                default: 60.0,
                min: 20.0,
                max: 2_000.0,
                help: "Lowest expected fundamental — the bottom of the autocorrelation search.",
            },
            OptionInfo {
                key: "maxF0Hz",
                label: "Max f0",
                default: 1_200.0,
                min: 40.0,
                max: 5_000.0,
                help: "Highest expected fundamental — the top of the autocorrelation search.",
            },
        ],
    ),
    (
        "downbeats",
        &[OptionInfo {
            key: "barLength",
            label: "Beats per bar",
            default: 4.0,
            min: 2.0,
            max: 12.0,
            help: "Beats per bar — the time-signature numerator.",
        }],
    ),
    (
        "loudnessMomentary",
        &[OptionInfo {
            key: "windowMs",
            label: "Window",
            default: 0.0,
            min: 0.0,
            max: 1_000.0,
            help: "Momentary window in ms; 0 uses the EBU R128 400 ms block.",
        }],
    ),
];

/// The engine options declared for `id` (empty for a tool without options).
fn options_for(id: &str) -> &'static [OptionInfo] {
    OPTIONS
        .iter()
        .find(|(tool, _)| *tool == id)
        .map(|(_, options)| *options)
        .unwrap_or(&[])
}

/// Whether `id` names an analyzer (so a headless `run_analysis` can fail fast with a
/// helpful message instead of the engine's generic unknown-tool error).
pub fn is_analyzer(id: &str) -> bool {
    ANALYZERS.iter().any(|analyzer| analyzer.id == id)
}

/// The catalog in the shape `list_analyzers` returns (an array of objects). Each
/// entry carries the analyzer's metadata plus a compact `options` map of its
/// canonical option keys to their defaults.
pub fn list() -> Vec<serde_json::Value> {
    ANALYZERS
        .iter()
        .map(|analyzer| {
            let options: serde_json::Map<String, serde_json::Value> = options_for(analyzer.id)
                .iter()
                .map(|option| (option.key.to_string(), serde_json::json!(option.default)))
                .collect();
            serde_json::json!({
                "id": analyzer.id,
                "title": analyzer.title,
                "description": analyzer.description,
                "section": analyzer.section,
                "keywords": analyzer.keywords,
                "options": options,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::canonical_option_key;

    #[test]
    fn catalog_covers_every_engine_tool() {
        // The engine's `run` knows these ids; the catalog must offer them all.
        for id in [
            "waveform",
            "levels",
            "frameRms",
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
            assert!(item["options"].is_object());
        }
    }

    #[test]
    fn option_metadata_names_known_canonical_keys() {
        for (id, options) in OPTIONS {
            assert!(is_analyzer(id), "option metadata for unknown analyzer {id}");
            for option in *options {
                assert_eq!(
                    canonical_option_key(option.key),
                    Some(option.key),
                    "{} is not a canonical option key",
                    option.key
                );
                assert!(option.min <= option.default && option.default <= option.max);
                assert!(!option.label.is_empty() && !option.help.is_empty());
            }
        }
    }

    #[test]
    fn list_carries_the_frame_rms_defaults() {
        let items = list();
        let frame_rms = items
            .iter()
            .find(|item| item["id"] == "frameRms")
            .expect("frameRms is in the catalog");
        assert_eq!(frame_rms["section"], "time");
        assert_eq!(frame_rms["options"]["frameMs"], 10.0);
        assert_eq!(frame_rms["options"]["hopMs"], 5.0);
    }

    #[test]
    fn list_carries_the_pitch_option_defaults() {
        let items = list();
        let find = |id: &str| items.iter().find(|item| item["id"] == id).unwrap();
        assert_eq!(find("pitchYin")["options"]["minF0Hz"], 50.0);
        assert_eq!(find("pitchYin")["options"]["maxF0Hz"], 2000.0);
        assert_eq!(find("pitchYin")["options"]["yinThreshold"], 0.12);
        assert_eq!(find("harmonicRatio")["options"]["maxF0Hz"], 4000.0);
        assert!(find("pitchPyin")["options"].as_object().unwrap().is_empty());
    }
}
