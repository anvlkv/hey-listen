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
//! reference side per tool. Saving writes the ones whose compare view is open; a load
//! replaces the whole map; a new project clears it.

use serde::Serialize;

use crate::audio::analysis::compare::{SavedComparison, SavedComparisonInfo};
use crate::audio::analyzers::AnalyzerId;

use super::{resolve_root, WindowRegistry, WindowState};

/// A compare view a popout shows: one tool against one reference project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareView {
    pub tool: String,
    /// The live reference project's window label, or the saved snapshot's name.
    pub with: String,
    /// Whether `with` names an A **saved snapshot** rather than a live project (M25.C).
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
    pub fn retarget_compare_popout(&self, label: &str, reference: &str, saved: bool) -> bool {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(view) = inner.popout_compares.get_mut(label) else {
            return false;
        };
        if view.with == reference && view.saved == saved {
            return false;
        }
        view.with = reference.to_string();
        view.saved = saved;
        true
    }

    /// The compare popout of `label`'s project showing `tool`, if one is open.
    pub fn compare_popout_for(&self, label: &str, tool: &str) -> Option<String> {
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
                .is_some_and(|view| view.tool == tool);
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
    /// Record the **last successful** comparison for `tool` (live or saved).
    pub fn store_saved_comparison(&self, snapshot: SavedComparison) {
        self.saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .insert(snapshot.tool, snapshot);
    }

    /// The saved reference side for `tool`, if the last comparison resolved.
    pub fn saved_comparison(&self, tool: AnalyzerId) -> Option<SavedComparison> {
        self.saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .get(&tool)
            .cloned()
    }

    /// Every saved reference snapshot, in stable tool order.
    pub fn saved_comparisons(&self) -> Vec<SavedComparison> {
        self.saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .values()
            .cloned()
            .collect()
    }

    /// Compact summaries of every saved comparison (for the picker and MCP).
    pub fn saved_comparison_infos(&self) -> Vec<SavedComparisonInfo> {
        self.saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .values()
            .map(SavedComparison::info)
            .collect()
    }

    /// The snapshots for the comparisons open at save time, in stable tool order.
    pub fn saved_comparisons_for(&self, tools: &[AnalyzerId]) -> Vec<SavedComparison> {
        let saved = self
            .saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut chosen: Vec<SavedComparison> = tools
            .iter()
            .filter_map(|tool| saved.get(tool).cloned())
            .collect();
        chosen.sort_by_key(|snapshot| snapshot.tool);
        chosen.dedup_by_key(|snapshot| snapshot.tool);
        chosen
    }

    /// Replace every saved comparison (a project load).
    pub fn replace_saved_comparisons(&self, snapshots: Vec<SavedComparison>) {
        let mut saved = self
            .saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        saved.clear();
        for snapshot in snapshots {
            saved.insert(snapshot.tool, snapshot);
        }
    }

    /// Keep only the given tools' snapshots (a save drops closed comparisons).
    pub fn retain_saved_comparisons(&self, tools: &[AnalyzerId]) {
        let mut saved = self
            .saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        saved.retain(|tool, _| tools.contains(tool));
    }

    /// Forget every saved comparison (a new project).
    pub fn clear_saved_comparisons(&self) {
        self.saved_compares
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clear();
    }
}
