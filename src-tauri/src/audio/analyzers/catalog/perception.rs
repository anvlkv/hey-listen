//! The **Perception** analyzer catalog entries, kept apart from [`super`] so the
//! base catalog stays inside the source-size budget.

use super::super::{AnalyzerId, AnalyzerInfo, Section};

/// The perceptual (auditory-model) tools, shown after the Loudness section.
pub(super) const PERCEPTION: &[AnalyzerInfo] = &[AnalyzerInfo {
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
}];
