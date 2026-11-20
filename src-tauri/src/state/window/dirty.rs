//! Unsaved-work tracking, owned by the core (M24.A phase 3).
//!
//! The frontend used to compare a signature of every store the project file stores with
//! the last clean point (`src/state/project/dirty.ts`, deleted). The core owns that
//! comparison now: [`ProjectDirty::signature`] is the canonical JSON of the project
//! snapshot with dockview's viewport-dependent pixel sizes stripped, plus the source
//! PCM's **shape** (not its samples) and the frontend's live compare-view signature —
//! the one input that is neither in the snapshot nor in `AudioState`.
//!
//! The baseline/settle machinery is the same shape as
//! [`ProjectHistory`](super::ProjectHistory), with one difference: a load (and a new
//! project) **brackets** its restore (`begin_project_baseline` / `end_project_baseline`),
//! and while that bracket is open the quiet clock is unarmed. A restore is not one
//! synchronous step — a streamed PCM, dockview re-serializing its layout after `fromJSON`,
//! the layout's popout windows being created — so the restore itself says when it is done;
//! only then does a quiet period (see `dirty/tick.rs` → `SETTLE_MS`) lock the baseline, so a
//! freshly loaded project never comes up marked dirty. See
//! [`undo-redo.md`](../../../../docs/undo-redo.md) → "Phase 3".

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::{SourceData, WindowRegistry};

/// The dirty accessors and `isEmptyProject` on `WindowState`.
mod accessors;
/// The signature's JSON half: the stripped content and the pushed `ui-state` inputs.
mod content;
/// The signature's behaviour (the settle clock, the upgrade marker, the compare input).
#[cfg(test)]
mod tests;
/// The settle clock: when a restore becomes the clean point, and why a project is dirty.
mod tick;

use content::stripped;
use tick::TICK_MS;

/// The event carrying the dirty flag to the project's windows.
pub const DIRTY_EVENT: &str = "project-dirty";

/// The `ui-state` key carrying the frontend's live compare-view signature. An open compare
/// view contributes its binding, offset and last-successful fingerprint, so a settled
/// change in a live reference marks this project dirty (M25.C).
pub const COMPARE_SIGNATURE_KEY: &str = "compareSignature";

/// The `ui-state` key saying whether each graph editor is still in its seeded shape — the
/// `isEmptyProject` input the core cannot derive without restating the node-kind defaults.
pub const GRAPH_PRISTINE_KEY: &str = "graphPristine";

/// Whether the project has unsaved edits, as broadcast after every change.
#[derive(Clone, Copy, Debug, Serialize)]
struct DirtyEvent {
    dirty: bool,
}

/// The window the tracker reports to (one per project, set on the first push).
#[derive(Clone)]
struct Target {
    app: AppHandle,
    label: String,
}

/// The source PCM's identity: `(frames, sample_rate, channels)`. The samples themselves
/// are not project content for this purpose (a recording's length is, a viewport resize is
/// not).
type SourceIdentity = (usize, u32, u16);

/// The signature at the last clean point, the current one, and the settle clock.
struct DirtyState {
    /// The signature at the last clean point (a save, a load, a new project).
    baseline: String,
    /// The signature most recently computed.
    current: String,
    /// The PCM identity `current` was computed for — read every tick, because a recording
    /// or a replaced source moves it without a push.
    source: SourceIdentity,
    /// When `current` last changed while restoring: the quiet clock.
    quiet_since: Option<Instant>,
    /// True while a load/new restores state, so the restore itself is not a change.
    baselining: bool,
    /// True while that restore is still running: the quiet clock is **not armed** until
    /// [`ProjectDirty::end_baseline`] says the restore is done, so a slow one (a streamed
    /// PCM, dockview re-mounting the tabs, the popout windows) cannot lock a baseline
    /// halfway through and read the rest as an edit.
    restoring: bool,
    /// Whether the project has unsaved edits (as last broadcast).
    dirty: bool,
}

impl Default for DirtyState {
    fn default() -> Self {
        Self {
            baseline: String::new(),
            current: String::new(),
            source: (0, 0, 0),
            quiet_since: None,
            // The app starts clean: the first settled state is the baseline.
            baselining: true,
            restoring: false,
            dirty: false,
        }
    }
}

/// One project's unsaved-work state.
///
/// Shared behind an `Arc` by [`WindowState`](super::WindowState), so the settle loop can
/// hold a **weak** reference: when the project's last window closes the state is dropped
/// and the loop exits (the `alive` flag is a second, explicit stop signal).
pub struct ProjectDirty {
    /// The project content the signature covers, as recorded by [`Self::note_snapshot`].
    content: Mutex<Value>,
    /// The source PCM, read for its shape only.
    source: Arc<Mutex<Option<SourceData>>>,
    /// The frontend's live compare-view signature (see [`COMPARE_SIGNATURE_KEY`]).
    compare: Mutex<Value>,
    state: Mutex<DirtyState>,
    /// The format version the loaded project was migrated from: an upgraded project stays
    /// dirty until a save writes the current version (ADR-32 / M37).
    upgraded_from: Mutex<Option<u32>>,
    /// Whether an input may have changed since the last tick.
    inputs: AtomicBool,
    /// Whether the loop has been spawned (it runs for the project's lifetime).
    running: AtomicBool,
    /// Where to emit, once the owning project has pushed a snapshot.
    target: Mutex<Option<Target>>,
    /// Flipped off when this state is dropped, so the loop stops.
    alive: Arc<AtomicBool>,
}

impl ProjectDirty {
    pub fn new(source: Arc<Mutex<Option<SourceData>>>) -> Self {
        Self {
            content: Mutex::new(Value::Null),
            source,
            compare: Mutex::new(Value::Null),
            state: Mutex::new(DirtyState::default()),
            upgraded_from: Mutex::new(None),
            // The first tick must compute the signature: the initial state is unknown.
            inputs: AtomicBool::new(true),
            running: AtomicBool::new(false),
            target: Mutex::new(None),
            alive: Arc::new(AtomicBool::new(true)),
        }
    }

    /// Record the project content a signature is computed from: the snapshot the frontend
    /// pushed, or the one an undo/redo restored (see [`content::stripped`]).
    pub fn note_snapshot(&self, snapshot: &crate::state::ProjectSnapshot) {
        let value = serde_json::to_value(snapshot).unwrap_or(Value::Null);
        *lock(&self.content) = stripped(&value);
        self.note();
    }

    /// The dirty signature: the project content (minus viewport sizes, keys sorted so a
    /// round-trip order cannot read as an edit), the source's shape, and the live
    /// compare-view signature.
    pub fn signature(&self) -> String {
        let (frames, sample_rate, channels) = self.source_identity();
        let value = serde_json::json!({
            "snapshot": lock(&self.content).clone(),
            "source": [frames, sample_rate, channels],
            "compare": lock(&self.compare).clone(),
        });
        serde_json::to_string(&value).unwrap_or_default()
    }

    /// Note that an input to the signature changed: a snapshot was pushed, or the
    /// compare-view signature arrived.
    pub fn note(&self) {
        self.inputs.store(true, Ordering::SeqCst);
    }

    pub fn set_compare_signature(&self, signature: Value) {
        {
            let mut compare = lock(&self.compare);
            if *compare == signature {
                return;
            }
            *compare = signature;
        }
        self.note();
    }

    /// Re-evaluate when a `ui-state` key that feeds the signature changes.
    pub fn note_ui(&self, key: &str, value: &Value) {
        if key == COMPARE_SIGNATURE_KEY {
            self.set_compare_signature(value.clone());
        }
    }

    /// Whether there are unsaved edits. An upgraded project is dirty until a save writes
    /// the current format version, so the notice and the marker agree.
    pub fn dirty(&self) -> bool {
        self.upgraded().is_some() || lock(&self.state).dirty
    }

    /// Recompute now and answer: a closing window must not trust a 50 ms-old flag.
    pub fn dirty_now(&self) -> bool {
        self.tick();
        self.dirty()
    }

    /// Take the current state as the clean baseline (a save).
    pub fn mark_clean(&self) {
        let signature = self.signature();
        let source = self.source_identity();
        let value = self.upgraded().is_some();
        let published = {
            let mut state = lock(&self.state);
            state.source = source;
            state.baseline = signature.clone();
            state.current = signature;
            let changed = value != state.dirty;
            state.dirty = value;
            changed.then_some(value)
        };
        if let Some(dirty) = published {
            self.publish(dirty);
        }
    }

    /// Suppress dirty tracking while a load/new restores state.
    ///
    /// The restore owns the **end** of the bracket ([`Self::end_baseline`]): while it runs,
    /// changes move the baseline with them and the quiet clock stays unarmed.
    pub fn begin_baseline(&self) {
        let mut state = lock(&self.state);
        state.baselining = true;
        state.restoring = true;
        state.quiet_since = None;
    }

    /// Re-arm the baseline once restored state has settled (see [`Self::tick`]).
    pub fn end_baseline(&self) {
        {
            let mut state = lock(&self.state);
            state.restoring = false;
            state.quiet_since = Some(Instant::now());
        }
        log::info!("project restore: the restored state becomes clean once it settles");
    }

    /// Set (or clear) the format version the project was migrated from.
    ///
    /// Clearing it (a save wrote the current version) re-derives the flag from the
    /// signature rather than from the marker that was forced on: the project is only clean
    /// afterwards if nothing else differs from the baseline either.
    pub fn set_upgraded_from(&self, from: Option<u32>) {
        {
            let mut upgraded = lock(&self.upgraded_from);
            if *upgraded == from {
                return;
            }
            *upgraded = from;
        }
        let (value, changed) = {
            let mut state = lock(&self.state);
            // While a restore is settling the settle decides the flag, not the signature
            // (as `markClean` did after it).
            let value = if state.baselining {
                state.dirty
            } else {
                from.is_some() || state.current != state.baseline
            };
            let changed = value != state.dirty;
            state.dirty = value;
            (value, changed)
        };
        if changed {
            self.publish(value);
        }
    }

    /// Point the loop at the owning project window and start it (once per project; later
    /// calls only refresh the target).
    pub fn arm(self: &Arc<Self>, app: AppHandle, label: String) {
        *lock(&self.target) = Some(Target { app, label });
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let weak = Arc::downgrade(self);
        let alive = self.alive.clone();
        // A blocking loop rather than an async one, as `ProjectHistory` has: it only
        // sleeps and computes, and `spawn_blocking` keeps it off the async workers.
        tauri::async_runtime::spawn_blocking(move || {
            while alive.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(TICK_MS));
                let Some(dirty) = weak.upgrade() else {
                    break;
                };
                dirty.tick();
            }
        });
    }

    fn upgraded(&self) -> Option<u32> {
        *lock(&self.upgraded_from)
    }

    fn source_identity(&self) -> SourceIdentity {
        let source = lock(&self.source);
        source.as_ref().map_or((0, 0, 0), |data| {
            (
                data.samples.len() / data.channels.max(1) as usize,
                data.sample_rate,
                data.channels,
            )
        })
    }

    /// Emit `project-dirty` to every window of the project.
    fn publish(&self, dirty: bool) {
        let Some(target) = lock(&self.target).clone() else {
            return;
        };
        let registry = target.app.state::<WindowRegistry>();
        for window in registry.project_windows(&target.label) {
            let _ = target
                .app
                .emit_to(&window, DIRTY_EVENT, DirtyEvent { dirty });
        }
    }
}

impl Drop for ProjectDirty {
    fn drop(&mut self) {
        // The project's last window closed (see `WindowRegistry::remove`).
        self.alive.store(false, Ordering::Relaxed);
    }
}

/// Lock a mutex, recovering from a poisoned one (a panic in another command must not take
/// the project's dirty tracking down with it).
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}
