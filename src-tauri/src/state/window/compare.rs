//! Compare popouts (M25) — the registry half.
//!
//! A compare popout is a native window that shows one comparison: it is **aliased** to
//! its owner project like any popout (so commands resolve to the project's state), but
//! it is registered in its own map with its `(tool, reference)`. Keeping it out of the
//! tool map is what makes it transient: `popout_tools_of` never returns it (so it is
//! never saved or restored), `sync_popouts` never opens it, and `close_popouts` closes
//! it with the project's other views. See `docs/comparison.md` → "Popout" and ADR-24.

use serde::Serialize;

use super::{resolve_root, WindowRegistry};

/// A compare view a popout shows: one tool against one reference project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareView {
    pub tool: String,
    /// The reference project's window label.
    pub with: String,
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
    pub fn retarget_compare_popout(&self, label: &str, reference: &str) -> bool {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(view) = inner.popout_compares.get_mut(label) else {
            return false;
        };
        if view.with == reference {
            return false;
        }
        view.with = reference.to_string();
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
