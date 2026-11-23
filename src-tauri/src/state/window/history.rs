//! One project's undo/redo state: the authoritative snapshot, the bounded stacks, and
//! the **core-owned trailing settle** that turns a settled gesture into one step.
//!
//! Split out of `state/window/mod.rs` to stay inside the source-size budget; it is the
//! `tauri`-aware half of [`crate::state::history`] (which is the pure reducer).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::history::UndoHistory;
use crate::state::snapshot::ProjectSnapshot;
use crate::state::WindowRegistry;

use super::WindowState;

/// How long a pushed snapshot must be quiet before it becomes an undo step: one gesture
/// (a drag, a field commit, a tab move) is one step.
pub const SETTLE_MS: Duration = Duration::from_millis(350);

/// How often the recorder looks for a settled snapshot.
const TICK_MS: u64 = 50;

/// The event carrying [`HistoryState`] to the project's windows, so the frontend's
/// `when` clauses (and any menu item) can enable or disable undo/redo.
pub const HISTORY_STATE_EVENT: &str = "history-state";

/// Whether undo/redo would do something, as broadcast after every change.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryState {
    pub can_undo: bool,
    pub can_redo: bool,
}

/// The window the recorder reports to (one per project, set on the first push).
#[derive(Clone)]
struct Recorder {
    app: AppHandle,
    label: String,
}

/// One project's history: the latest pushed snapshot, the undo/redo stacks, and the
/// settle recorder.
///
/// Shared behind an `Arc` by [`WindowState`], so the recorder can hold a **weak**
/// reference to it: when the project's last window closes, the state is dropped and the
/// loop exits (and the `alive` flag is a second, explicit stop signal).
pub struct ProjectHistory {
    /// The latest snapshot the frontend pushed (with `compare` filled by the core).
    latest: Mutex<ProjectSnapshot>,
    /// When that snapshot arrived — the settle's clock. `None` when nothing is pending.
    pending_since: Mutex<Option<Instant>>,
    /// The bounded stacks.
    stacks: Mutex<UndoHistory>,
    /// Where to emit, once the owning project has pushed a snapshot.
    recorder: Mutex<Option<Recorder>>,
    /// Whether the settle loop has been spawned (it runs for the project's lifetime).
    recording: AtomicBool,
    /// Whether the stacks are still waiting for a **base**: the first settled snapshot is
    /// rebased onto, never recorded as a step (a freshly opened project has an empty
    /// undo stack). Cleared by the first [`commit_now`](Self::commit_now) and set again by
    /// [`reset`](Self::reset).
    baselining: AtomicBool,
    /// Flipped off when this state is dropped, so the loop stops.
    alive: Arc<AtomicBool>,
}

impl Default for ProjectHistory {
    fn default() -> Self {
        Self {
            latest: Mutex::new(ProjectSnapshot::default()),
            pending_since: Mutex::new(None),
            stacks: Mutex::new(UndoHistory::new(ProjectSnapshot::default())),
            recorder: Mutex::new(None),
            recording: AtomicBool::new(false),
            baselining: AtomicBool::new(true),
            alive: Arc::new(AtomicBool::new(true)),
        }
    }
}

impl ProjectHistory {
    pub fn new() -> Self {
        Self::default()
    }

    /// Store the latest snapshot and arm the settle. The caller has already filled
    /// `compare` (the core owns the saved comparisons).
    pub fn note(&self, snapshot: ProjectSnapshot) {
        *lock(&self.latest) = snapshot;
        *lock(&self.pending_since) = Some(Instant::now());
    }

    /// The latest snapshot the frontend pushed, with `compare` filled by the core.
    ///
    /// This is the project content a save writes (M24.A phase 2): one projection serves
    /// undo, save and the restore broadcast.
    pub fn latest(&self) -> ProjectSnapshot {
        lock(&self.latest).clone()
    }

    /// Read the latest snapshot under the history's lock, without cloning it (a query
    /// such as "are there annotations?" must not copy whole result payloads).
    pub fn read_latest<R>(&self, read: impl FnOnce(&ProjectSnapshot) -> R) -> R {
        read(&lock(&self.latest))
    }

    /// Commit the pending snapshot as one step now, ignoring the settle; returns whether
    /// a step was recorded. Undo/redo call this first, so a step made moments ago is
    /// undoable instead of being lost to the settle.
    ///
    /// While [`baselining`](Self::reset), the snapshot **rebases** the stacks instead of
    /// becoming a step: the state a project opens with is its base, not an edit.
    pub fn commit_now(&self) -> bool {
        let snapshot = lock(&self.latest).clone();
        let mut stacks = lock(&self.stacks);
        let recorded = if self.baselining.swap(false, Ordering::SeqCst) {
            stacks.reset(snapshot);
            false
        } else {
            stacks.commit(snapshot)
        };
        *lock(&self.pending_since) = None;
        recorded
    }

    /// Commit the pending snapshot once it has been quiet for [`SETTLE_MS`].
    pub fn commit_pending(&self) -> bool {
        let Some(since) = *lock(&self.pending_since) else {
            return false;
        };
        if since.elapsed() < SETTLE_MS {
            return false;
        }
        self.commit_now()
    }

    /// Step back, returning the snapshot to restore (the new current state).
    pub fn undo(&self) -> Option<ProjectSnapshot> {
        self.commit_now();
        let restored = lock(&self.stacks).undo()?;
        self.adopt(&restored);
        Some(restored)
    }

    /// Step forward, returning the snapshot to restore (the new current state).
    pub fn redo(&self) -> Option<ProjectSnapshot> {
        self.commit_now();
        let restored = lock(&self.stacks).redo()?;
        self.adopt(&restored);
        Some(restored)
    }

    /// Drop every step and make the latest snapshot the base (New / Open / source change).
    ///
    /// The stacks are cleared at once **and** the state is armed for a settle: the load
    /// keeps settling over the next few ticks (dockview re-serializes its layout, popouts
    /// reconcile), and a push during that quiet period re-arms the clock, so the base is
    /// whatever state the project has settled on rather than a half-restored one.
    pub fn reset(&self) {
        let base = lock(&self.latest).clone();
        self.baselining.store(true, Ordering::SeqCst);
        *lock(&self.pending_since) = Some(Instant::now());
        lock(&self.stacks).reset(base);
    }

    /// Whether undo would step somewhere: either a recorded step exists, or the pending
    /// snapshot would become one (so a window does not lose the first 350 ms of an edit).
    /// False while [`baselining`](Self::reset): the open state is the base, not a step.
    pub fn can_undo(&self) -> bool {
        if self.baselining.load(Ordering::SeqCst) {
            return false;
        }
        let latest = lock(&self.latest).clone();
        let stacks = lock(&self.stacks);
        stacks.can_undo() || stacks.would_record(&latest)
    }

    /// Whether redo would step somewhere.
    pub fn can_redo(&self) -> bool {
        if self.baselining.load(Ordering::SeqCst) {
            return false;
        }
        lock(&self.stacks).can_redo()
    }

    /// The restore becomes the latest state, so the push it triggers dedupes against it
    /// instead of recording the undo itself as a new step.
    fn adopt(&self, snapshot: &ProjectSnapshot) {
        *lock(&self.latest) = snapshot.clone();
        *lock(&self.pending_since) = None;
    }

    /// Point the recorder at the owning project window and start the settle loop (once
    /// per project; later calls only refresh the target).
    pub fn arm(self: &Arc<Self>, app: AppHandle, label: String) {
        *lock(&self.recorder) = Some(Recorder { app, label });
        if self.recording.swap(true, Ordering::SeqCst) {
            return;
        }
        let weak = Arc::downgrade(self);
        let alive = self.alive.clone();
        // A blocking loop rather than an async one: the crate has no timer dependency,
        // and the loop only waits. `spawn_blocking` keeps it off the async workers, so no
        // command ever waits on it.
        tauri::async_runtime::spawn_blocking(move || {
            while alive.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(TICK_MS));
                let Some(history) = weak.upgrade() else {
                    break;
                };
                history.settle();
            }
        });
    }

    /// Commit a settled snapshot, then tell the project's windows the new availability.
    fn settle(&self) {
        if self.commit_pending() {
            self.broadcast();
        }
    }

    /// Emit `history-state` to every window of the project.
    pub fn broadcast(&self) {
        let recorder = lock(&self.recorder).clone();
        let Some(recorder) = recorder else {
            return;
        };
        broadcast_history_state(
            &recorder.app,
            &recorder.label,
            self.can_undo(),
            self.can_redo(),
        );
    }
}

impl Drop for ProjectHistory {
    fn drop(&mut self) {
        // The project's last window closed (see `WindowRegistry::remove`).
        self.alive.store(false, Ordering::Relaxed);
    }
}

/// Emit `history-state` to every window of `label`'s project, the caller included.
pub fn broadcast_history_state(app: &AppHandle, label: &str, can_undo: bool, can_redo: bool) {
    let registry = app.state::<WindowRegistry>();
    let state = HistoryState { can_undo, can_redo };
    for window in registry.project_windows(label) {
        let _ = app.emit_to(&window, HISTORY_STATE_EVENT, state);
    }
}

impl WindowState {
    /// Point this project's history at `app`/`label` (idempotent).
    pub fn arm_history(&self, app: AppHandle, label: String) {
        self.history.arm(app, label);
    }

    /// Record the project's latest state; `compare` is filled from the core's saved
    /// comparisons, which the frontend does not hold.
    pub fn push_project_state(&self, mut snapshot: ProjectSnapshot) {
        // The dirty signature reads the frontend's own content, recorded before `compare`
        // is filled — a saved comparison carries whole result payloads (M24.A phase 3).
        self.dirty.note_snapshot(&snapshot);
        snapshot.compare = self.saved_comparisons();
        self.history.note(snapshot);
    }

    /// The project content as the core last received it — what a save serializes.
    pub fn project_snapshot(&self) -> ProjectSnapshot {
        self.history.latest()
    }

    /// Commit a settled snapshot (`SETTLE_MS` of quiet) as one step.
    pub fn commit_pending(&self) -> bool {
        self.history.commit_pending()
    }

    /// Step back to the previous project state, if there is one.
    pub fn undo(&self) -> Option<ProjectSnapshot> {
        let restored = self.history.undo()?;
        // The restore is the state on screen, so it is also the dirty signature's input —
        // undo back to the clean point must clear the marker without waiting for a push.
        self.dirty.note_snapshot(&restored);
        Some(restored)
    }

    /// Step forward to the next project state, if there is one.
    pub fn redo(&self) -> Option<ProjectSnapshot> {
        let restored = self.history.redo()?;
        self.dirty.note_snapshot(&restored);
        Some(restored)
    }

    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    /// Drop every step and rebase on the latest snapshot (New / Open / source change).
    pub fn reset_history(&self) {
        self.history.reset();
    }

    /// Emit this project's undo/redo availability to its windows.
    pub fn broadcast_history(&self) {
        self.history.broadcast();
    }
}

/// Lock a mutex, recovering from a poisoned one (a panic in another command must not take
/// the project's history down with it).
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
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

    /// The symptom this guards against: a fresh project recorded its open state as a step
    /// and came up with an undo stack ~350 ms after boot.
    #[test]
    fn the_first_settle_is_a_rebase_not_a_step() {
        let history = ProjectHistory::new();
        // The state the window really opens with (not the seeded default).
        history.note(snap("Untitled project"));

        assert!(!history.commit_now());
        assert!(!history.can_undo());
        assert!(!history.can_redo());
    }

    #[test]
    fn a_reset_rebases_again() {
        let history = ProjectHistory::new();
        history.note(snap("one"));
        history.commit_now();
        history.note(snap("two"));
        assert!(history.commit_now());
        assert!(history.can_undo());

        // New / Open: the stacks clear and the next settle is the new base.
        history.reset();
        assert!(!history.can_undo());
        assert!(!history.can_redo());

        // The load keeps settling: a push after the reset still only rebases.
        history.note(snap("three"));
        assert!(!history.commit_now());
        assert!(!history.can_undo());
    }

    #[test]
    fn a_change_after_the_base_is_locked_is_a_step() {
        let history = ProjectHistory::new();
        history.note(snap("base"));
        history.commit_now();
        assert!(!history.can_undo());

        history.note(snap("edit"));
        // The pending snapshot already counts, so an undo in the settle window works.
        assert!(history.can_undo());
        assert!(history.commit_now());
        assert_eq!(
            history.undo().map(|snapshot| snapshot.name),
            Some("base".into())
        );
        assert!(history.can_redo());
    }

    #[test]
    fn can_undo_is_false_while_baselining_even_if_the_state_differs() {
        // The stacks are seeded with `ProjectSnapshot::default()`; the pending state is
        // already different from it, and still must not read as a step.
        let history = ProjectHistory::new();
        history.note(snap("Untitled project"));
        assert!(!history.can_undo());
        assert!(!history.can_redo());
    }
}
