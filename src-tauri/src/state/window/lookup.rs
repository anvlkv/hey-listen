//! The alias-chain and popout lookups [`WindowRegistry`](super::WindowRegistry) is built
//! on: a popout is a **view** of its parent project, so every lookup resolves the alias
//! chain to the owning project window first.

use std::collections::HashMap;
use std::sync::MutexGuard;

use super::RegistryInner;

/// Follow the popout alias chain to the owning (project) window label.
pub(super) fn resolve_root(aliases: &HashMap<String, String>, label: &str) -> String {
    let mut current = label.to_string();
    let mut seen = std::collections::HashSet::new();
    while let Some(parent) = aliases.get(&current) {
        if !seen.insert(current.clone()) {
            break;
        }
        current = parent.clone();
    }
    current
}

/// The popout of `label`'s project whose `shown` table (popout label → shown id) maps it to
/// `id`, if one is open. `shown` is the tool map or the annotation map, so the two kinds
/// share one lookup.
pub(super) fn popout_showing<K, Q>(
    inner: &MutexGuard<'_, RegistryInner>,
    label: &str,
    shown: &HashMap<String, K>,
    id: &Q,
) -> Option<String>
where
    K: std::borrow::Borrow<Q>,
    Q: PartialEq + ?Sized,
{
    let root = resolve_root(&inner.aliases, label);
    inner.aliases.iter().find_map(|(popout, parent)| {
        let same_project = resolve_root(&inner.aliases, parent) == root;
        let shows_id = shown.get(popout).map(std::borrow::Borrow::borrow) == Some(id);
        (same_project && shows_id).then(|| popout.clone())
    })
}
