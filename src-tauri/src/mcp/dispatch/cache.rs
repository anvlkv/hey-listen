//! The headless session's analyzer result cache (D-22).
//!
//! The GUI keeps its results in `src/state/analyzer/cache.ts` and writes them to the
//! project's `RESULTS` section. The headless session keeps the same entries, so an MCP/CLI
//! run adopts a result it already holds instead of recomputing it, and `save_project`
//! writes them rather than `results: []`.
//!
//! A result is filed under the same inputs the frontend keys on — the tool, the window it
//! covers, the shared params, and the **effective** options — so an unchanged run adopts
//! the entry instead of computing it again. The GUI also keys on the applied filter; a
//! [`StoredResult`] has no field for it, so the session instead **clears** the cache
//! whenever the source or the filter is replaced (`mod.rs` / `session.rs` / `project.rs`).

use std::collections::BTreeMap;

use crate::audio::analysis::{AnalysisResult, SharedParams, StoredAnalysisResult, ToolOptions};
use crate::audio::analyzers::AnalyzerId;
use crate::project::StoredResult;

use super::project::numeric_options;
use super::HeadlessSession;

impl HeadlessSession {
    /// The cached result for `key`, decoded from the entry's postcard payload.
    ///
    /// A payload that does not decode — or one that decodes to another tool's result — is
    /// a **miss**, never an error: the call falls through to a real run and replaces the
    /// entry.
    pub(super) fn cached_result(&self, key: &CacheKey) -> Option<AnalysisResult> {
        let entry = self.results.iter().find(|entry| key.matches(entry))?;
        let stored = postcard::from_bytes::<StoredAnalysisResult>(&entry.result).ok()?;
        let result = AnalysisResult::from(stored);
        (result.tool_id() == key.tool).then_some(result)
    }

    /// File a freshly computed result under `key`, replacing an entry with the same key
    /// rather than appending a duplicate.
    pub(super) fn store_result(&mut self, key: &CacheKey, result: &AnalysisResult) {
        let fresh = key.entry(result);
        match self.results.iter_mut().find(|cached| key.matches(cached)) {
            Some(slot) => *slot = fresh,
            None => self.results.push(fresh),
        }
    }
}

/// What a cached result is keyed on: the tool, the window it covers, and the shared params
/// and **effective** options it was computed with — the inputs the frontend's cache keys on.
///
/// The applied filter is deliberately absent (there is no field for it in a
/// [`StoredResult`]), so a filter change clears the session's cache instead. A window or
/// params/options change needs no clearing: it simply misses.
pub(super) struct CacheKey {
    tool: AnalyzerId,
    start: f64,
    end: f64,
    params: SharedParams,
    options: BTreeMap<String, f64>,
}

impl CacheKey {
    /// The key for a run. `options` is the resolved [`ToolOptions`] the engine reads, filed
    /// in the project file's numeric option-map form.
    pub(super) fn new(
        tool: AnalyzerId,
        start: f64,
        end: f64,
        params: &SharedParams,
        options: &ToolOptions,
    ) -> Self {
        Self {
            tool,
            start,
            end,
            params: params.clone(),
            options: numeric_options(options),
        }
    }

    /// Whether `entry` was computed for exactly this key.
    fn matches(&self, entry: &StoredResult) -> bool {
        entry.tool == self.tool
            && entry.start == self.start
            && entry.end == self.end
            && entry.options == self.options
            && same_params(&entry.params, &self.params)
    }

    /// The `RESULTS` entry for a result computed under this key.
    ///
    /// A payload that postcard cannot encode is written empty: it never files a wrong
    /// result, and an empty payload is a miss when read back.
    fn entry(&self, result: &AnalysisResult) -> StoredResult {
        StoredResult {
            tool: self.tool,
            start: self.start,
            end: self.end,
            params: self.params.clone(),
            options: self.options.clone(),
            result: postcard::to_stdvec(&StoredAnalysisResult::from(result)).unwrap_or_default(),
        }
    }
}

/// Whether two param sets are the same cache key — compared through their one `Serialize`
/// impl, so the field list is not restated here.
fn same_params(a: &SharedParams, b: &SharedParams) -> bool {
    match (serde_json::to_value(a), serde_json::to_value(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}
