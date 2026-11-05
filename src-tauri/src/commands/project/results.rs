//! Cached analyzer results for the project file's `RESULTS` section.
//!
//! The frontend sends its result cache with `save_project` as the tagged JSON the
//! `run_analysis` response carried, and `load_project` hands the cache back as typed
//! `AnalysisResult`s so a reopened project restores its results instead of re-running
//! every analyzer. The on-disk entry stays [`StoredResult`]; see
//! `docs/project-file-format.md`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::audio::analysis::{AnalysisResult, SharedParams, StoredAnalysisResult};
use crate::audio::analyzers::AnalyzerId;
use crate::project::StoredResult;

/// One cached result the frontend sends with `save_project`.
#[derive(Debug, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CachedResultInput {
    pub tool: AnalyzerId,
    pub start: f64,
    pub end: f64,
    pub params: SharedParams,
    #[serde(default)]
    pub options: BTreeMap<String, f64>,
    /// The `run_analysis` result object (the tagged `AnalysisResult` JSON).
    pub result: serde_json::Value,
}

/// One cached result `load_project` returns; the frontend seeds its cache with these.
#[derive(Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CachedResultOutput {
    pub tool: AnalyzerId,
    pub start: f64,
    pub end: f64,
    pub params: SharedParams,
    pub options: BTreeMap<String, f64>,
    pub result: AnalysisResult,
}

/// Encode the frontend's cache for the file.
///
/// An entry this build cannot convert is logged and skipped: a single bad result must
/// never fail the whole save.
pub(super) fn to_stored(inputs: Vec<CachedResultInput>) -> Vec<StoredResult> {
    inputs
        .into_iter()
        .filter_map(|input| {
            let tool = input.tool;
            match encode(input.result) {
                Ok(result) => Some(StoredResult {
                    tool,
                    start: input.start,
                    end: input.end,
                    params: input.params,
                    options: input.options,
                    result,
                }),
                Err(err) => {
                    log::warn!("skipping the cached {tool} result: {err}");
                    None
                }
            }
        })
        .collect()
}

/// The tagged JSON → postcard bytes. `AnalysisResult` is internally tagged, which
/// `postcard` cannot decode, so the file holds the postcard-safe mirror instead (the
/// `COMPARE` section's approach).
fn encode(value: serde_json::Value) -> Result<Vec<u8>, String> {
    let result = serde_json::from_value::<AnalysisResult>(value)
        .map_err(|err| format!("not an analysis result: {err}"))?;
    postcard::to_stdvec(&StoredAnalysisResult::from(&result))
        .map_err(|err| format!("could not encode it: {err}"))
}

/// Decode the file's cache for the frontend.
///
/// An entry written by a different build is logged and skipped (forward/backward
/// compatibility) rather than failing the load.
pub(super) fn to_cached(stored: Vec<StoredResult>) -> Vec<CachedResultOutput> {
    stored
        .into_iter()
        .filter_map(|entry| {
            let tool = entry.tool;
            match decode(entry.result) {
                Ok(result) => Some(CachedResultOutput {
                    tool,
                    start: entry.start,
                    end: entry.end,
                    params: entry.params,
                    options: entry.options,
                    result,
                }),
                Err(err) => {
                    log::warn!("skipping the cached {tool} result: {err}");
                    None
                }
            }
        })
        .collect()
}

/// The postcard bytes → a typed result the frontend cache can hold.
fn decode(bytes: Vec<u8>) -> Result<AnalysisResult, String> {
    postcard::from_bytes::<StoredAnalysisResult>(&bytes)
        .map(StoredAnalysisResult::into)
        .map_err(|err| format!("could not decode it: {err}"))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{to_cached, to_stored, CachedResultInput};
    use crate::audio::analysis::{fixtures, AnalysisResult, SharedParams};
    use crate::audio::analyzers::AnalyzerId;
    use crate::project::StoredResult;

    fn input(result: serde_json::Value) -> CachedResultInput {
        CachedResultInput {
            tool: AnalyzerId::Spectrum,
            start: 1.5,
            end: 2.5,
            params: SharedParams {
                fft_size: 2_048,
                hop: 0.5,
                ..Default::default()
            },
            options: BTreeMap::from([("topPeaks".to_string(), 3.0)]),
            result,
        }
    }

    #[test]
    fn round_trips_a_cached_result() {
        let result = AnalysisResult::Spectrum(fixtures::spectrum());
        let json = serde_json::to_value(&result).expect("json");

        let stored = to_stored(vec![input(json)]);
        assert_eq!(stored.len(), 1);

        let loaded = to_cached(stored);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].tool, AnalyzerId::Spectrum);
        assert_eq!(loaded[0].start, 1.5);
        assert_eq!(loaded[0].end, 2.5);
        assert_eq!(loaded[0].options.get("topPeaks"), Some(&3.0));
        assert_eq!(loaded[0].result.tool_id(), AnalyzerId::Spectrum);
    }

    #[test]
    fn unreadable_entries_are_skipped() {
        // Not an analysis result: dropped, not a failed save.
        let stored = to_stored(vec![input(serde_json::json!({ "tool": "nope" }))]);
        assert!(stored.is_empty());

        // Bytes this build cannot decode: dropped, not a failed load.
        let garbage = StoredResult {
            tool: AnalyzerId::Spectrum,
            start: 0.0,
            end: 1.0,
            params: SharedParams::default(),
            options: BTreeMap::new(),
            result: vec![1, 2, 3],
        };
        assert!(to_cached(vec![garbage]).is_empty());
    }
}
