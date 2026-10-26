//! The **result family** of each analyzer: how `run_analysis` shapes it, and whether
//! `maxPoints` is a safe request.
//!
//! An agent should not have to guess whether a tool returns a series, a matrix, or a
//! list of events. The family is part of the catalog (`list_analyzers` /
//! `get_analyzer`) and matches the shaper's arms in
//! [`crate::audio::analysis::shape`].

/// How a tool's result is shaped on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    /// Scalars only (level meters, integrated loudness, LRA).
    Scalar,
    /// One scalar per frame, with a time axis (`frameRms`, spectral series, pitch).
    Series,
    /// A spectrum: parallel bin arrays (`freqs` + magnitudes), no time axis.
    Spectrum,
    /// A frame × band matrix (`melSpectrogram`, `mfcc`, `chromagram`, contrast).
    Matrix,
    /// A frame × bin heatmap with a scaled hop (`spectrogram`).
    Spectrogram,
    /// A time axis plus detected event lists (`tempo`, `onsets`, `downbeats`).
    Events,
    /// Detected note records with spans and gaps (`noteMetrics`).
    Notes,
}

impl Family {
    /// The stable wire name (`"series"`, `"matrix"`, …).
    pub fn as_str(self) -> &'static str {
        match self {
            Family::Scalar => "scalar",
            Family::Series => "series",
            Family::Spectrum => "spectrum",
            Family::Matrix => "matrix",
            Family::Spectrogram => "spectrogram",
            Family::Events => "events",
            Family::Notes => "notes",
        }
    }

    /// Whether `maxPoints` is meaningful for this family. Event/note lists are never
    /// thinned (that would drop events), and scalars have no arrays.
    pub fn decimatable(self) -> bool {
        matches!(
            self,
            Family::Series
                | Family::Spectrum
                | Family::Matrix
                | Family::Spectrogram
                | Family::Events
        )
    }
}

/// The family for an analyzer id (unknown ids are treated as scalar).
pub fn family_of(id: &str) -> Family {
    match id {
        "levels" | "loudnessIntegrated" | "loudnessRange" => Family::Scalar,
        "spectrum" => Family::Spectrum,
        "spectrogram" => Family::Spectrogram,
        "melSpectrogram" | "mfcc" | "chromagram" | "spectralContrast" => Family::Matrix,
        "noteMetrics" => Family::Notes,
        "tempo" | "onsets" | "downbeats" => Family::Events,
        _ => Family::Series,
    }
}

/// Tool-specific guidance that is longer than the one-line catalog description.
///
/// The two segmentation tools are the ones agents most often confuse: spectral-flux
/// peaks are not gated sound events, and the gated segmenter is `noteMetrics`.
pub fn about(id: &str) -> Option<&'static str> {
    match id {
        "onsets" => Some(
            "Spectral-flux onset peaks: each entry is a frame where the spectrum changed \
             sharply. The detector is not gated, so noise can produce events (roughly \
             nine per second on a quiet field recording). Use `noteMetrics` for gated \
             sound segments with start/end/duration, or `frameRms` to inspect the \
             envelope directly.",
        ),
        "noteMetrics" => Some(
            "Gated sound events: contiguous above-threshold runs with hysteresis, a \
             minimum note/gap, per-note level and envelope, f0, and voice-quality \
             proxies. This is the segmentation tool for calls/syllables. Set \
             `syllableGapMs` to also return `syllables` (adjacent notes merged across a \
             short gap); the note spans are unchanged, and amplitude belongs to the \
             syllable rather than an individual note. Pair it with `frameRms` (a 10 ms/\
             5 ms linear envelope) to see what the gate sees.",
        ),
        "frameRms" => Some(
            "A linear amplitude envelope in dBFS at a fine hop (default 10 ms frame / \
             5 ms hop). Use this to inspect or threshold sound events; \
             `loudnessMomentary` is a 400 ms EBU R128 block by default and smears short \
             calls. Set `gateDb` (with an optional `gateFloorDb`) to turn frames far below \
             the window peak into gaps, so pre-roll and background are excluded.",
        ),
        "harmonicRatio" => Some(
            "Max normalized autocorrelation over the f0 search range — **not HNR in dB**. \
             It measures periodicity at the best-matching lag, so broadband noise can \
             score high, and per-cycle jitter or detune barely move it. Use \
             `spectralFlatness` for noisiness and the per-note `hnrProxy` only as the \
             same correlation proxy. Set `gateDb` to exclude background frames.",
        ),
        "pitchPyin" | "pitchYin" | "pitchAutocorr" => Some(
            "A median f0 is only a pitch when enough frames are voiced: below **8 voiced \
             frames** `f0Reliable` is 0 and the summary omits `medianF0Hz`/`meanF0Hz` \
             (the track itself is still returned). Read `voicedFrames` and \
             `voicedFraction` before trusting a track, especially for noisy or \
             intermittent recordings.",
        ),
        "modulation" => Some(
            "AM and FM spectra over the same rate axis. The FM half needs a voiced run at \
             least `minVoicedSecs` long whose cents track is not a staircase of a few \
             quantized levels; otherwise `fmReliable` is 0 and `fmDb`/`fmPeaks`/\
             `fmRateHz` stay empty (the cents spread is still reported). A steady run is \
             reliable and simply reports no rate.",
        ),
        "loudnessMomentary" => Some(
            "EBU R128 momentary loudness over time. The default 400 ms block is useful \
             for programme loudness, not for finding call boundaries; lower `windowMs` \
             or use `frameRms` when short events matter.",
        ),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analyzers::ANALYZERS;

    #[test]
    fn every_analyzer_has_a_family() {
        for analyzer in ANALYZERS {
            // The match is exhaustive by construction; this pins the interesting ones.
            assert!(!family_of(analyzer.id).as_str().is_empty());
        }
        assert_eq!(family_of("noteMetrics"), Family::Notes);
        assert_eq!(family_of("onsets"), Family::Events);
        assert_eq!(family_of("mfcc"), Family::Matrix);
        assert_eq!(family_of("spectrogram"), Family::Spectrogram);
        assert_eq!(family_of("pitchPyin"), Family::Series);
        assert_eq!(family_of("levels"), Family::Scalar);
    }

    #[test]
    fn event_lists_are_not_decimatable() {
        assert!(!Family::Notes.decimatable());
        assert!(!Family::Scalar.decimatable());
        assert!(Family::Series.decimatable());
        assert!(Family::Events.decimatable());
    }

    #[test]
    fn segmentation_tools_explain_themselves() {
        assert!(about("onsets").is_some_and(|text| text.contains("noteMetrics")));
        assert!(about("noteMetrics").is_some_and(|text| text.contains("frameRms")));
        assert!(about("spectrum").is_none());
    }

    #[test]
    fn harmonic_ratio_is_not_described_as_hnr_in_db() {
        let text = about("harmonicRatio").expect("harmonicRatio guidance");
        assert!(text.contains("not HNR in dB"), "{text}");
        assert!(text.contains("spectralFlatness"), "{text}");
    }

    #[test]
    fn pitch_and_modulation_explain_their_reliability_flags() {
        for id in ["pitchPyin", "pitchYin", "pitchAutocorr"] {
            let text = about(id).expect("pitch guidance");
            assert!(text.contains("f0Reliable"), "{id}: {text}");
        }
        let modulation = about("modulation").expect("modulation guidance");
        assert!(modulation.contains("fmReliable"), "{modulation}");
        let notes = about("noteMetrics").expect("note guidance");
        assert!(notes.contains("syllableGapMs"), "{notes}");
    }
}
