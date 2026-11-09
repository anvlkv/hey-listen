//! The **Perception** analyzer catalog entries, kept apart from [`super`] so the
//! base catalog stays inside the source-size budget.

use super::super::{AnalyzerId, AnalyzerInfo, Section};

/// The perceptual (auditory-model) tools, shown after the Loudness section.
pub(super) const PERCEPTION: &[AnalyzerInfo] = &[
    AnalyzerInfo {
        id: AnalyzerId::CriticalBands,
        title: "Critical bands",
        description: "Bark or ERB critical-band energy over time",
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
        description: "Perceived loudness — ISO 532-2 stationary sones over time",
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
        description: "N'(z) specific-loudness map over ERB bands",
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
            "Perceived sharpness — high-frequency emphasis of the specific-loudness distribution",
        section: Section::Perception,
        keywords: &["sharpness", "brightness", "acum", "perception"],
    },
    AnalyzerInfo {
        id: AnalyzerId::Roughness,
        title: "Roughness",
        description: "Perceived roughness — band-envelope modulation near 70 Hz",
        section: Section::Perception,
        keywords: &["roughness", "asper", "harsh", "buzzy", "perception"],
    },
    AnalyzerInfo {
        id: AnalyzerId::FluctuationStrength,
        title: "Fluctuation strength",
        description: "Perceived fluctuation strength — slow modulation near 4 Hz",
        section: Section::Perception,
        keywords: &["fluctuation", "vacil", "pulsing", "am", "perception"],
    },
    AnalyzerInfo {
        id: AnalyzerId::Masking,
        title: "Masking",
        description: "Masking threshold + signal-to-mask ratio over the spectrum",
        section: Section::Perception,
        keywords: &["masking", "audibility", "smr", "threshold", "perception"],
    },
    AnalyzerInfo {
        id: AnalyzerId::Tonality,
        title: "Tonality",
        description: "Tonal-energy ratio proxy over time",
        section: Section::Perception,
        keywords: &["tonality", "tonal", "ratio", "proxy", "perception"],
    },
];
