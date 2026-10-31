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
//! The catalog data lives in [`catalog`]; the option metadata (split out to keep the
//! files small) in [`options`]; the `list_analyzers` payload lives here.

mod catalog;
mod family;
mod id;
mod options;

#[allow(unused_imports)]
pub use family::{about, family_of, Family};
pub use id::{AnalyzerId, ToolId};

use serde_json::{json, Map, Value};

use crate::audio::analysis::ToolOptions;

/// The Sidebar grouping of an analyzer (mirrors `AnalyzerSection` in the frontend).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    serde::Serialize,
    serde::Deserialize,
    strum::EnumString,
    strum::Display,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::EnumIter,
    strum::VariantNames,
    ts_rs::TS,
)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
#[ts(export, rename_all = "camelCase")]
pub enum Section {
    Time,
    Spectral,
    Pitch,
    Rhythm,
    Loudness,
}

/// One analyzer's agent-facing metadata (mirrors `AnalyzerDef` in the frontend,
/// minus the view/params detail the webview needs).
pub struct AnalyzerInfo {
    pub id: AnalyzerId,
    pub title: &'static str,
    pub description: &'static str,
    pub section: Section,
    pub keywords: &'static [&'static str],
}

/// Every analyzer, grouped by section, in the order the Sidebar shows them.
pub const ANALYZERS: &[AnalyzerInfo] = catalog::ANALYZERS;

/// An analyzer's human title (`"Spectrum"`).
pub fn title(id: AnalyzerId) -> Option<&'static str> {
    ANALYZERS
        .iter()
        .find(|analyzer| analyzer.id == id)
        .map(|analyzer| analyzer.title)
}

/// A tool's compact option map: canonical camelCase keys to their defaults.
pub fn option_defaults(id: AnalyzerId) -> Map<String, Value> {
    options::options_for(id)
        .iter()
        .map(|option| (option.key.to_string(), json!(option.default)))
        .collect()
}

/// One tool's **effective** options: its declared defaults overlaid with the non-`null`
/// fields set on `overrides`. Shared by `get_state`, `run_analysis`, and exports so
/// every surface reports the same values — and so none leaks the all-`Option`
/// [`ToolOptions`] struct, which would print every other tool's keys as `null`.
pub fn effective_options(id: AnalyzerId, overrides: Option<&ToolOptions>) -> Map<String, Value> {
    let mut options = option_defaults(id);
    if let Some(overrides) = overrides {
        if let Ok(Value::Object(values)) = serde_json::to_value(overrides) {
            for (key, value) in values {
                if !value.is_null() {
                    options.insert(key, value);
                }
            }
        }
    }
    options
}

/// One analyzer's full detail, the shape `get_analyzer` returns. The `about` copy is
/// the short description here — the GUI overlays the frontend registry's longer copy.
pub fn detail(id: AnalyzerId) -> Option<Value> {
    let analyzer = ANALYZERS.iter().find(|analyzer| analyzer.id == id)?;
    let options: Vec<Value> = options::options_for(id)
        .iter()
        .map(options::option_meta)
        .collect();
    Some(json!({
        "id": analyzer.id,
        "title": analyzer.title,
        "description": analyzer.description,
        "about": about(analyzer.id).unwrap_or(analyzer.description),
        "section": analyzer.section,
        "family": family_of(analyzer.id),
        "decimatable": family_of(analyzer.id).decimatable(),
        "keywords": analyzer.keywords,
        "options": options,
        "summaryKeys": crate::audio::analysis::summary_keys(analyzer.id),
    }))
}

/// The catalog in the shape `list_analyzers` returns (an array of objects). Each
/// entry carries the analyzer's metadata plus a compact `options` map of its
/// canonical option keys to their defaults.
pub fn list() -> Vec<Value> {
    ANALYZERS
        .iter()
        .map(|analyzer| {
            json!({
                "id": analyzer.id,
                "title": analyzer.title,
                "description": analyzer.description,
                "section": analyzer.section,
                "family": family_of(analyzer.id),
                "keywords": analyzer.keywords,
                "options": option_defaults(analyzer.id),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::canonical_option_key;
    use strum::IntoEnumIterator;

    #[test]
    fn catalog_covers_every_engine_tool() {
        // `AnalyzerId` is the source of truth; the catalog must offer every variant.
        for id in AnalyzerId::iter() {
            assert!(
                ANALYZERS.iter().any(|analyzer| analyzer.id == id),
                "catalog is missing {id}"
            );
        }
        assert_eq!(ANALYZERS.len(), AnalyzerId::iter().count());
    }

    #[test]
    fn list_is_non_empty_and_shaped() {
        let items = list();
        assert_eq!(items.len(), ANALYZERS.len());
        for item in items {
            assert!(item["id"].as_str().is_some_and(|id| !id.is_empty()));
            assert!(item["title"].as_str().is_some_and(|t| !t.is_empty()));
            assert!(item["family"].as_str().is_some_and(|f| !f.is_empty()));
            assert!(item["keywords"].as_array().is_some());
            assert!(item["options"].is_object());
        }
    }

    #[test]
    fn option_metadata_names_known_canonical_keys() {
        for (id, options) in options::tables() {
            assert!(
                ANALYZERS.iter().any(|analyzer| analyzer.id == id),
                "option metadata for unknown analyzer {id}"
            );
            for option in options {
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
    fn list_carries_the_note_metrics_defaults() {
        let items = list();
        let note = items
            .iter()
            .find(|item| item["id"] == "noteMetrics")
            .expect("noteMetrics is in the catalog");
        assert_eq!(note["section"], "pitch");
        assert_eq!(note["options"]["frameMs"], 10.0);
        assert_eq!(note["options"]["gateDb"], 35.0);
        assert_eq!(note["options"]["gateFloorDb"], -60.0);
        assert_eq!(note["options"]["hysteresisDb"], 3.0);
        assert_eq!(note["options"]["minNoteMs"], 20.0);
        assert_eq!(note["options"]["minGapMs"], 30.0);
        assert_eq!(note["options"]["syllableGapMs"], 0.0);
        assert_eq!(note["options"]["envelopePoints"], 7.0);
        // M19's per-note pitch grid and f0 range.
        assert_eq!(note["options"]["pitchFrameMs"], 40.0);
        assert_eq!(note["options"]["pitchHopMs"], 5.0);
        assert_eq!(note["options"]["minF0Hz"], 50.0);
        assert_eq!(note["options"]["maxF0Hz"], 2000.0);
    }

    #[test]
    fn list_carries_the_modulation_defaults() {
        let items = list();
        let modulation = items
            .iter()
            .find(|item| item["id"] == "modulation")
            .expect("modulation is in the catalog");
        assert_eq!(modulation["section"], "spectral");
        assert_eq!(modulation["options"]["frameMs"], 10.0);
        assert_eq!(modulation["options"]["hopMs"], 2.5);
        assert_eq!(modulation["options"]["modMinHz"], 0.5);
        assert_eq!(modulation["options"]["modMaxHz"], 100.0);
        assert_eq!(modulation["options"]["detrend"], 1.0);
        assert_eq!(modulation["options"]["minVoicedSecs"], 0.2);
        assert_eq!(modulation["options"]["topPeaks"], 3.0);
        assert_eq!(modulation["options"]["minF0Hz"], 50.0);
        assert_eq!(modulation["options"]["maxF0Hz"], 2000.0);
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

    #[test]
    fn gated_series_tools_declare_the_window_gate() {
        let items = list();
        for id in [
            "frameRms",
            "harmonicRatio",
            "spectralCentroid",
            "spectralRolloff",
            "spectralFlatness",
            "zeroCrossingRate",
        ] {
            let item = items.iter().find(|item| item["id"] == id).unwrap();
            assert_eq!(item["options"]["gateDb"], 0.0, "{id}: gateDb");
            assert_eq!(item["options"]["gateFloorDb"], -120.0, "{id}: gateFloorDb");
        }
    }
}
