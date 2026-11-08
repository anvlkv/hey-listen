//! The typed ids for analyzers and Workbench tabs (M15.B, ADR-28).
//!
//! `AnalyzerId` is the single source of truth for every analysis tool id. The
//! `workbench_ids!` list below defines it **and** `ToolId` (the same ids plus the two
//! graph editors, `filter` / `synth`), so the two enums cannot drift: the conversion
//! and the tab-id subset are generated from one variant list.
//!
//! `serde` is implemented by hand (rather than derived) so an enum value encodes as
//! the **same string** everywhere: in JSON (IPC / MCP / CLI) and in the `postcard`
//! project file. A derived `Serialize` would encode the variant index under postcard,
//! silently changing the file format. `strum` supplies the matching `FromStr` /
//! `Display` / `AsRefStr` spelling (`camelCase`), and `ts-rs` exports the union so the
//! frontend imports the same ids instead of re-declaring them.

use serde::de::{self, Deserialize, Deserializer};
use serde::ser::{Serialize, Serializer};

/// Implement string serde for an id enum (see the module note).
macro_rules! wire_id {
    ($ty:ty, $kind:literal) => {
        impl Serialize for $ty {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                let value: &'static str = self.into();
                serializer.serialize_str(value)
            }
        }

        impl<'de> Deserialize<'de> for $ty {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let value = String::deserialize(deserializer)?;
                value.parse().map_err(|_| {
                    de::Error::custom(format!(
                        "unknown {} id: {value} (expected one of {})",
                        $kind,
                        <$ty as strum::VariantNames>::VARIANTS.join(", ")
                    ))
                })
            }
        }
    };
}

/// Define `AnalyzerId` and `ToolId` from one variant list. Both are **wire** ids: their
/// `serde` is hand-written by [`wire_id!`], so `id_enum!` gets no extra derives.
macro_rules! workbench_ids {
    ($($variant:ident),* $(,)?) => {
        id_enum! {
            []
            []
            /// The analyzer tool ids (every analyzer in `docs/analysis-tools.md`).
            pub enum AnalyzerId {
                $($variant),*
            }
        }

        id_enum! {
            []
            []
            /// A Workbench tab id: an analyzer, or one of the graph editors.
            pub enum ToolId {
                /// The filter graph editor tab.
                Filter,
                /// The synth graph editor tab.
                Synth,
                $($variant),*
            }
        }

        impl From<AnalyzerId> for ToolId {
            fn from(id: AnalyzerId) -> Self {
                match id {
                    $(AnalyzerId::$variant => ToolId::$variant),*
                }
            }
        }

        impl ToolId {
            /// The analyzer this tab shows, or `None` for a graph editor.
            pub fn analyzer(self) -> Option<AnalyzerId> {
                match self {
                    ToolId::Filter | ToolId::Synth => None,
                    $(ToolId::$variant => Some(AnalyzerId::$variant)),*
                }
            }
        }
    };
}

workbench_ids! {
    Waveform,
    Levels,
    FrameRms,
    Spectrum,
    Spectrogram,
    MelSpectrogram,
    Mfcc,
    Chromagram,
    SpectralCentroid,
    SpectralFlux,
    SpectralRolloff,
    SpectralFlatness,
    SpectralContrast,
    SpectralBandwidth,
    SpectralEntropy,
    SpectralCrest,
    HarmonicRatio,
    ZeroCrossingRate,
    Modulation,
    PitchPyin,
    PitchYin,
    PitchAutocorr,
    NoteMetrics,
    Tempo,
    Onsets,
    Downbeats,
    LoudnessIntegrated,
    LoudnessMomentary,
    LoudnessRange,
    CriticalBands,
}

wire_id!(AnalyzerId, "analyzer");
wire_id!(ToolId, "tool");

#[cfg(test)]
mod tests {
    use super::*;
    use strum::{IntoEnumIterator, VariantNames};

    #[test]
    fn serde_and_strum_agree_on_every_id() {
        for id in AnalyzerId::iter() {
            let json = serde_json::to_string(&id).expect("serialize");
            assert_eq!(json, format!("\"{id}\""));
            let parsed: AnalyzerId = serde_json::from_str(&json).expect("parse");
            assert_eq!(parsed, id);
        }
    }

    #[test]
    fn postcard_encodes_an_id_as_its_string() {
        // The project file stores ids in `postcard`; the hand-written serde keeps the
        // bytes identical to the old `String` fields (M15.B is not a format bump).
        for id in AnalyzerId::iter() {
            let expected = postcard::to_allocvec(&id.to_string()).expect("string bytes");
            let actual = postcard::to_allocvec(&id).expect("id bytes");
            assert_eq!(actual, expected, "{id}");
        }
        for id in ToolId::iter() {
            let expected = postcard::to_allocvec(&id.to_string()).expect("string bytes");
            let actual = postcard::to_allocvec(&id).expect("tool bytes");
            assert_eq!(actual, expected, "{id}");
        }
    }

    #[test]
    fn tool_id_carries_every_analyzer() {
        for id in AnalyzerId::iter() {
            assert_eq!(ToolId::from(id).analyzer(), Some(id));
        }
        assert_eq!(ToolId::Filter.analyzer(), None);
        assert_eq!(ToolId::Synth.analyzer(), None);
        assert_eq!(ToolId::VARIANTS.len(), AnalyzerId::VARIANTS.len() + 2);
    }
}
