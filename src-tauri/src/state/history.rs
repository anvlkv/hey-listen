//! The bounded undo/redo stacks over [`ProjectSnapshot`].
//!
//! Deliberately free of `tauri` types so the reducer is unit-testable; the per-project
//! wiring (the settle recorder, the restore broadcast) lives in
//! [`crate::state::window::history`].

use std::mem;

use crate::state::snapshot::{canonical_json, ProjectSnapshot};

/// The most steps one project keeps. A long session must not grow without bound.
pub const MAX_HISTORY: usize = 100;

/// A snapshot history: the current state plus the steps behind and ahead of it.
///
/// `current` is the state on screen, not a step: `undo` moves the previous step back
/// onto `current` and parks the one it replaced on `redo`, so a step is only ever
/// recorded by [`commit`](Self::commit).
#[derive(Debug, Default)]
pub struct UndoHistory {
    undo: Vec<ProjectSnapshot>,
    redo: Vec<ProjectSnapshot>,
    current: ProjectSnapshot,
}

impl UndoHistory {
    /// A history whose base step is `snapshot` (a New / Open boundary).
    pub fn new(snapshot: ProjectSnapshot) -> Self {
        Self {
            undo: Vec::new(),
            redo: Vec::new(),
            current: snapshot,
        }
    }

    /// Drop every step and make `snapshot` the base (New / Open / source change), so
    /// undo can never step across a project boundary.
    pub fn reset(&mut self, snapshot: ProjectSnapshot) {
        self.undo.clear();
        self.redo.clear();
        self.current = snapshot;
    }

    /// Record `snapshot` as one step; returns whether a step was recorded.
    ///
    /// A snapshot identical to `current` — ignoring object key order — is not a step
    /// (a JSON round-trip that only reordered keys must not create one).
    pub fn commit(&mut self, snapshot: ProjectSnapshot) -> bool {
        if !self.would_record(&snapshot) {
            return false;
        }
        self.undo.push(mem::replace(&mut self.current, snapshot));
        if self.undo.len() > MAX_HISTORY {
            self.undo.remove(0);
        }
        self.redo.clear();
        true
    }

    /// Whether [`commit`](Self::commit) would record `snapshot` as a step.
    pub fn would_record(&self, snapshot: &ProjectSnapshot) -> bool {
        key(snapshot) != key(&self.current)
    }

    /// Step back one edit, returning the snapshot to restore (the new current).
    pub fn undo(&mut self) -> Option<ProjectSnapshot> {
        let previous = self.undo.pop()?;
        let replaced = mem::replace(&mut self.current, previous.clone());
        self.redo.push(replaced);
        Some(previous)
    }

    /// Step forward one undone edit, returning the snapshot to restore.
    pub fn redo(&mut self) -> Option<ProjectSnapshot> {
        let next = self.redo.pop()?;
        let replaced = mem::replace(&mut self.current, next.clone());
        self.undo.push(replaced);
        Some(next)
    }

    /// Whether there is a step behind the current state.
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    /// Whether there is a step ahead of the current state.
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}

/// The comparison key of a snapshot: its canonical JSON.
fn key(snapshot: &ProjectSnapshot) -> serde_json::Value {
    serde_json::to_value(snapshot)
        .map(|value| canonical_json(&value))
        .unwrap_or(serde_json::Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A snapshot distinguished only by its name (everything else is the default).
    fn snap(name: &str) -> ProjectSnapshot {
        ProjectSnapshot {
            name: name.to_string(),
            ..ProjectSnapshot::default()
        }
    }

    #[test]
    fn a_key_order_only_change_is_not_a_step() {
        let mut before = snap("project");
        before.layout = serde_json::from_str(r#"{"grid":{"width":1,"height":2},"panels":[]}"#)
            .expect("layout json");
        let mut after = snap("project");
        after.layout = serde_json::from_str(r#"{"panels":[],"grid":{"height":2,"width":1}}"#)
            .expect("layout json");

        let mut history = UndoHistory::new(before);
        assert!(!history.commit(after));
        assert!(!history.can_undo());
    }

    #[test]
    fn a_changed_snapshot_is_one_step_and_clears_redo() {
        let mut history = UndoHistory::new(snap("base"));
        assert!(history.commit(snap("one")));
        assert!(history.can_undo());
        assert!(history.undo().is_some());
        assert!(history.can_redo());

        // A new edit abandons the redo branch.
        assert!(history.commit(snap("two")));
        assert!(!history.can_redo());
    }

    #[test]
    fn undo_and_redo_move_the_current_state() {
        let mut history = UndoHistory::new(snap("base"));
        history.commit(snap("one"));
        history.commit(snap("two"));

        assert_eq!(history.undo().map(|s| s.name), Some("one".into()));
        assert_eq!(history.undo().map(|s| s.name), Some("base".into()));
        assert!(!history.can_undo());
        assert!(history.undo().is_none());

        assert_eq!(history.redo().map(|s| s.name), Some("one".into()));
        assert_eq!(history.redo().map(|s| s.name), Some("two".into()));
        assert!(!history.can_redo());
    }

    #[test]
    fn the_stack_is_capped_and_drops_the_oldest_step() {
        let mut history = UndoHistory::new(snap("0"));
        for index in 1..=150 {
            history.commit(snap(&index.to_string()));
        }
        let mut steps = 0;
        while history.undo().is_some() {
            steps += 1;
        }
        assert_eq!(steps, MAX_HISTORY);
    }

    #[test]
    fn reset_drops_both_stacks_and_rebases_the_current_state() {
        let mut history = UndoHistory::new(snap("base"));
        history.commit(snap("one"));
        history.undo();
        assert!(history.can_redo());

        history.reset(snap("other project"));
        assert!(!history.can_undo());
        assert!(!history.can_redo());
        // The new base is the current state, so re-committing it is not a step.
        assert!(!history.would_record(&snap("other project")));
        assert!(history.would_record(&snap("an edit")));
    }
}
