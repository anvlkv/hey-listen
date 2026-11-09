//! The **Perception** analyzer catalog entries, kept apart from [`super`] so the
//! base catalog stays inside the source-size budget.

use super::super::{AnalyzerId, AnalyzerInfo, Section};

/// The perceptual (auditory-model) tools, shown after the Loudness section.
pub(super) const PERCEPTION: &[AnalyzerInfo] = &[
    AnalyzerInfo {
        id: AnalyzerId::CriticalBands,
        title: "Critical bands",
        description:
            "Bark or ERB critical-band energy over time (rectangular bin integration, not an auditory filterbank)",
        section: Section::Perception,
        keywords: &[
            "critical",
            "band",
            "bark",
            "erb",
            "psychoacoustic",
            "perception",
            "energy",
        ],
    },
    AnalyzerInfo {
        id: AnalyzerId::Loudness,
        title: "Loudness (sone/phon)",
        description:
            "Perceived loudness — Moore–Glasberg stationary sone/phon approximation (not validated ISO 532-2)",
        section: Section::Perception,
        keywords: &[
            "loudness",
            "sone",
            "phon",
            "moore",
            "glasberg",
            "iso",
            "perception",
        ],
    },
    AnalyzerInfo {
        id: AnalyzerId::SpecificLoudness,
        title: "Specific loudness",
        description:
            "N'(z) specific-loudness map over ERB bands — sone/Cam density (custom approximation)",
        section: Section::Perception,
        keywords: &[
            "specific",
            "loudness",
            "erb",
            "sone",
            "moore",
            "glasberg",
            "perception",
        ],
    },
    AnalyzerInfo {
        id: AnalyzerId::Sharpness,
        title: "Sharpness",
        description:
            "Perceived sharpness — custom Bark-weighted loudness model in acum (not DIN 45692 validated)",
        section: Section::Perception,
        keywords: &["sharpness", "brightness", "acum", "perception"],
    },
    AnalyzerInfo {
        id: AnalyzerId::Roughness,
        title: "Roughness",
        description:
            "Perceived roughness — custom band-envelope model near 70 Hz in asper (not ECMA-418-2 validated)",
        section: Section::Perception,
        keywords: &["roughness", "asper", "harsh", "buzzy", "perception"],
    },
    AnalyzerInfo {
        id: AnalyzerId::FluctuationStrength,
        title: "Fluctuation strength",
        description:
            "Perceived fluctuation strength — custom band-envelope model near 4 Hz in vacil (unvalidated)",
        section: Section::Perception,
        keywords: &["fluctuation", "vacil", "pulsing", "am", "perception"],
    },
    AnalyzerInfo {
        id: AnalyzerId::Masking,
        title: "Masking",
        description:
            "Masking threshold + signal-to-mask ratio — MPEG-style codec estimate, not a universal detection model",
        section: Section::Perception,
        keywords: &["masking", "audibility", "smr", "threshold", "perception"],
    },
    AnalyzerInfo {
        id: AnalyzerId::Tonality,
        title: "Tonality",
        description:
            "Tonal-energy ratio proxy over time (dimensionless; not standardized perceptual tonality)",
        section: Section::Perception,
        keywords: &["tonality", "tonal", "ratio", "proxy", "perception"],
    },
    AnalyzerInfo {
        id: AnalyzerId::Spatial,
        title: "Spatial",
        description:
            "Mid/side levels and inter-channel correlation over time (acoustic cues, not perceived width)",
        section: Section::Perception,
        keywords: &[
            "spatial",
            "mid",
            "side",
            "correlation",
            "stereo",
            "perception",
        ],
    },
];
