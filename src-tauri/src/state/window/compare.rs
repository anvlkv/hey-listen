//! Compare popouts (M25) — the registry half, plus the per-project saved comparison
//! snapshots (M25.C).
//!
//! A compare popout is a native window that shows one comparison: it is **aliased** to
//! its owner project like any popout (so commands resolve to the project's state), but
//! it is registered in its own map with its `(tool, reference)`. Keeping it out of the
//! tool map is what makes it transient: `popout_tools_of` never returns it (so it is
//! never saved or restored), `sync_popouts` never opens it, and `close_popouts` closes
//! it with the project's other views. See `docs/comparison.md` → "Popout" and ADR-24.
//!
//! The registry also holds each project's **saved comparisons**: the last successful
//! reference side of every pair (one compare tab = one pair, several per tool). Saving
//! writes the ones whose comparisons are open; a load replaces the whole list; a new
//! project clears it.

use serde::Serialize;

use crate::audio::analysis::compare::{SavedComparison, SavedComparisonInfo};
use crate::audio::analyzers::AnalyzerId;

use super::{resolve_root, WindowRegistry, WindowState};

/// A compare view a popout shows: one comparison (one tool against one reference
/// project), identified by its stable pair `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareView {
    /// The comparison's stable id (several comparisons may share a tool).
    pub id: String,
    pub tool: AnalyzerId,
    /// The live reference project's window label, or the saved snapshot's name.
    pub with: String,
    /// Whether `with` names the A **saved snapshot** rather than a live project (M25.C).
    #[serde(default)]
    pub saved: bool,
}

impl WindowRegistry {
    /// Register `popout` as a compare view of `parent`'s project.
    pub fn add_compare_popout(&self, popout: &str, parent: &str, view: CompareView) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.aliases.insert(popout.to_string(), parent.to_string());
        inner.popout_compares.insert(popout.to_string(), view);
    }

    /// The compare view a popout shows, or `None`.
    pub fn compare_popout(&self, label: &str) -> Option<CompareView> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.popout_compares.get(label).cloned()
    }

    /// Retarget the compare view a popout shows; `true` when it changed.
    pub fn retarget_compare_popout(&self, label: &str, view: CompareView) -> bool {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(current) = inner.popout_compares.get_mut(label) else {
            return false;
        };
        if *current == view {
            return false;
        }
        *current = view;
        true
    }

    /// The compare popout of `label`'s project showing comparison `id`, if one is open.
    pub fn compare_popout_for(&self, label: &str, id: &str) -> Option<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = resolve_root(&inner.aliases, label);
        inner.aliases.iter().find_map(|(popout, parent)| {
            let same_project = resolve_root(&inner.aliases, parent) == root;
            let shows = inner
                .popout_compares
                .get(popout)
                .is_some_and(|view| view.id == id);
            (same_project && shows).then(|| popout.clone())
        })
    }

    /// Every compare popout of `label`'s project.
    pub fn compare_popouts_of(&self, label: &str) -> Vec<CompareView> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = resolve_root(&inner.aliases, label);
        inner
            .popout_compares
            .iter()
            .filter(|(popout, _)| {
                inner
                    .aliases
                    .get(*popout)
                    .is_some_and(|parent| resolve_root(&inner.aliases, parent) == root)
            })
            .map(|(_, view)| view.clone())
            .collect()
    }
}

impl WindowState {
    /// Record the **last successful** comparison of one pair (live or saved).
    ///
    /// The snapshot's `id` is its identity (several comparisons may share a tool), so a
    /// debounced re-run of one tab replaces that tab's entry instead of appending a new
    /// one on every run.
    pub fn store_saved_comparison(&self, snapshot: SavedComparison) {
        let mut saved = self
            .saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let existing = saved.iter().position(|entry| entry.id == snapshot.id);
        match existing {
            Some(index) => saved[index] = snapshot,
            None => saved.push(snapshot),
        }
    }

    /// The id a newly recorded snapshot is stored under: the caller's own id, or the
    /// existing id of the same pair (an **id-less** caller updates one entry per pair),
    /// or a fresh one.
    pub fn pin_comparison_id(&self, requested: &str, snapshot: &SavedComparison) -> String {
        if !requested.is_empty() {
            return requested.to_string();
        }
        let saved = self
            .saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        saved
            .iter()
            .find(|entry| entry.same_pair(snapshot))
            .map(|entry| entry.id.clone())
            .unwrap_or_else(|| SavedComparison::new_id(snapshot.saved_ms))
    }

    /// The most recent saved reference side for `tool`, if a comparison resolved.
    pub fn saved_comparison(&self, tool: AnalyzerId) -> Option<SavedComparison> {
        let saved = self
            .saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        saved
            .iter()
            .filter(|snapshot| snapshot.tool == tool)
            .max_by_key(|snapshot| snapshot.saved_ms)
            .cloned()
    }

    /// The saved snapshot with `id` for `tool`, if it exists.
    pub fn saved_comparison_by_id(&self, tool: AnalyzerId, id: &str) -> Option<SavedComparison> {
        let saved = self
            .saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        saved
            .iter()
            .find(|snapshot| snapshot.tool == tool && snapshot.id == id)
            .cloned()
    }

    /// The snapshot a caller selected by `id`: that pair when it exists, otherwise the
    /// newest one for `tool`. The fallback covers a view whose id belongs to a **live**
    /// comparison that has no saved snapshot yet (or was just retargeted to a saved pair).
    pub fn saved_comparison_selected(
        &self,
        tool: AnalyzerId,
        id: Option<&str>,
    ) -> Option<SavedComparison> {
        let selected = id
            .filter(|id| !id.is_empty())
            .and_then(|id| self.saved_comparison_by_id(tool, id));
        selected.or_else(|| self.saved_comparison(tool))
    }

    /// Every saved snapshot, in a stable `(tool, savedMs, id)` order.
    pub fn saved_comparisons(&self) -> Vec<SavedComparison> {
        let saved = self
            .saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut all = saved.clone();
        all.sort_by(|a, b| (a.tool, a.saved_ms, &a.id).cmp(&(b.tool, b.saved_ms, &b.id)));
        all
    }

    /// Compact summaries of every saved comparison (for the picker and MCP).
    pub fn saved_comparison_infos(&self) -> Vec<SavedComparisonInfo> {
        self.saved_comparisons()
            .iter()
            .map(SavedComparison::info)
            .collect()
    }

    /// Every snapshot of the comparisons open at save time, in stable tool order.
    pub fn saved_comparisons_for(&self, ids: &[String]) -> Vec<SavedComparison> {
        self.saved_comparisons()
            .into_iter()
            .filter(|snapshot| ids.contains(&snapshot.id))
            .collect()
    }

    /// Replace every saved comparison (a project load).
    pub fn replace_saved_comparisons(&self, snapshots: Vec<SavedComparison>) {
        *self
            .saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = snapshots;
    }

    /// Keep only the given comparisons' snapshots (a save drops closed ones).
    pub fn retain_saved_comparisons(&self, ids: &[String]) {
        self.saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .retain(|snapshot| ids.contains(&snapshot.id));
    }

    /// Forget every saved comparison (a new project).
    pub fn clear_saved_comparisons(&self) {
        self.saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clear();
    }
}
