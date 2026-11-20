//! Per-window state (one window = one project = one source, ADR-3).
//!
//! Every project window owns its own [`WindowState`]; [`WindowRegistry`] maps a window
//! label onto it, following popout aliases so a popout is a **view** of its parent
//! project rather than a project of its own (ADR-11). See `docs/decisions.md`.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::audio::analysis::compare::SavedComparison;
use crate::audio::analysis::Cancels;
use crate::audio::analyzers::ToolId;
use crate::audio::capture::CaptureHandle;

use super::AudioState;

mod compare;
mod dirty;
mod history;
/// Alias-chain and popout lookups (a popout is a view of its project).
mod lookup;

pub use compare::CompareView;
pub use dirty::ProjectDirty;
pub use history::ProjectHistory;

use lookup::{popout_showing, resolve_root};

// ---------------------------------------------------------------------------
// Per-window state (one window = one project = one source, ADR-3)
// ---------------------------------------------------------------------------

/// The core state that belongs to a single project window: the owned source PCM
/// (ADR-9), the active filter graph, the preview player, at most one live capture
/// session, and the project's undo/redo history. Each window gets its own instance, so
/// independent project windows never share audio — see [`WindowRegistry`].
pub struct WindowState {
    pub audio: AudioState,
    /// The window's running capture session (mic / system / process / mix).
    pub capture: Mutex<Option<CaptureHandle>>,
    /// The project's shared **UI state** (timeline window/view, analysis params,
    /// per-tool options and chart views, project name, popped-out tools). The frontend
    /// owns the shape; the core stores and broadcasts it to every window of the project.
    pub ui: Mutex<HashMap<String, serde_json::Value>>,
    /// Bumped on every UI-state change, so a peer comparison can tell that a project moved.
    ui_revision: AtomicU64,
    /// The last successful comparison of every **pair** (M25.C): each compare tab's
    /// reference side, kept in memory (written on save, restored on load).
    saved_compares: Mutex<Vec<SavedComparison>>,
    /// The project's undo/redo history: the authoritative snapshot, the bounded stacks
    /// and the core-owned settle recorder (`docs/undo-redo.md`).
    pub history: Arc<ProjectHistory>,
    /// The project's unsaved-work tracking: it compares the pushed snapshot with the last
    /// clean point and broadcasts the flag (`docs/undo-redo.md` → "Phase 3").
    pub dirty: Arc<ProjectDirty>,
    /// In-flight analysis runs (`request_id` → cancel token), so `cancel_analysis` can
    /// stop a superseded run at its next check (D-21). Its lock is a leaf, never held
    /// across a run.
    pub analysis_cancels: Cancels,
}

impl WindowState {
    fn new() -> Self {
        let audio = AudioState::new();
        let history = Arc::new(ProjectHistory::new());
        // The dirty signature reads the source's shape, so it shares the audio handle.
        let dirty = Arc::new(ProjectDirty::new(audio.source.clone()));
        Self {
            audio,
            capture: Mutex::new(None),
            ui: Mutex::new(HashMap::new()),
            ui_revision: AtomicU64::new(0),
            saved_compares: Mutex::new(Vec::new()),
            history,
            dirty,
            analysis_cancels: Cancels::default(),
        }
    }

    /// Apply a UI-state patch; returns the revision it was stored at, or `None` when the
    /// value did not change (so the caller can skip broadcasting it).
    pub fn set_ui(&self, key: &str, value: serde_json::Value) -> Option<u64> {
        let revision = {
            let mut ui = self.ui.lock().unwrap_or_else(|poison| poison.into_inner());
            if ui.get(key) == Some(&value) {
                return None;
            }
            ui.insert(key.to_string(), value.clone());
            self.ui_revision.fetch_add(1, Ordering::Relaxed) + 1
        };
        // Some keys feed the dirty signature (the compare views); re-evaluate them.
        self.dirty.note_ui(key, &value);
        Some(revision)
    }

    /// The UI-state revision (monotonic within a process). A window that pulls the
    /// snapshot uses it to drop patches the snapshot already contains.
    pub fn ui_revision(&self) -> u64 {
        self.ui_revision.load(Ordering::Relaxed)
    }

    /// The project's revision: UI plus audio changes, monotonic within a process.
    /// A comparison polls it and re-runs when it moves (M25).
    pub fn revision(&self) -> u64 {
        self.ui_revision.load(Ordering::Relaxed) + self.audio.revision()
    }

    /// Snapshot the whole UI state (what a freshly opened window pulls on load).
    pub fn ui_snapshot(&self) -> HashMap<String, serde_json::Value> {
        self.ui
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }
}

impl Default for WindowState {
    fn default() -> Self {
        Self::new()
    }
}

/// Registry of per-window state, keyed by window label.
///
/// Created lazily on first use and dropped when the window is destroyed (which also
/// shuts the window's preview player down): each label resolves to its own
/// [`WindowState`], while the app-wide stores stay shared.
///
/// Popout windows are **views** of a project, not projects of their own: their label is
/// aliased to the parent's, so every command resolves to the parent's [`WindowState`]
/// (the shared source / filter / playback). The alias also records what it shows.
#[derive(Default)]
struct RegistryInner {
    states: HashMap<String, Arc<WindowState>>,
    /// Popout label → parent label (a popout shares its parent's project state).
    aliases: HashMap<String, String>,
    /// Popout label → tool id shown in that popout.
    popout_tools: HashMap<String, ToolId>,
    /// Popout label → annotation id shown in that popout.
    popout_annotations: HashMap<String, String>,
    /// Popout label → the **compare** view it shows (M25). Kept apart from the tool
    /// map so a compare popout is never saved, restored or raised as a tool popout.
    popout_compares: HashMap<String, CompareView>,
    /// Popout labels that show the **log preview** (ADR-33). Kept apart from the tool and
    /// annotation maps so the preview is never saved, restored or raised as one — it is a
    /// view of the app, not of the project that happened to open it.
    log_popouts: HashSet<String>,
}

#[derive(Default)]
pub struct WindowRegistry {
    inner: Mutex<RegistryInner>,
}

impl WindowRegistry {
    /// The state for `label`, following popout aliases to the owning project
    /// window. Creates the (resolved) state on first use.
    pub fn get(&self, label: &str) -> Arc<WindowState> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let current = resolve_root(&inner.aliases, label);
        inner
            .states
            .entry(current)
            .or_insert_with(|| Arc::new(WindowState::new()))
            .clone()
    }

    /// The existing state for `label`, **without** creating one.
    ///
    /// Peer reads (a comparison's reference project) must resolve against live state:
    /// a closed project is an error, never a lazily created empty window (M25).
    pub fn peek(&self, label: &str) -> Option<Arc<WindowState>> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let current = resolve_root(&inner.aliases, label);
        inner.states.get(&current).cloned()
    }

    /// Follow the popout alias chain to the owning (project) window label.
    ///
    /// Used by the MCP server to route a tool call to the *project* window rather
    /// than a popout that happens to be focused.
    pub fn root_label(&self, label: &str) -> String {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        resolve_root(&inner.aliases, label)
    }

    /// Register `popout` as a view of `parent`'s project showing `tool`.
    pub fn add_popout(&self, popout: &str, parent: &str, tool: ToolId) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.aliases.insert(popout.to_string(), parent.to_string());
        inner.popout_tools.insert(popout.to_string(), tool);
    }

    /// The tool a popout window shows, or `None` for a regular project window.
    pub fn popout_tool(&self, label: &str) -> Option<ToolId> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.popout_tools.get(label).cloned()
    }

    /// Register `popout` as a view of `parent`'s project showing the annotation `annotation_id`.
    pub fn add_annotation_popout(&self, popout: &str, parent: &str, annotation_id: &str) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.aliases.insert(popout.to_string(), parent.to_string());
        inner
            .popout_annotations
            .insert(popout.to_string(), annotation_id.to_string());
    }

    /// The annotation a popout window shows, or `None` for a tool popout / project window.
    pub fn popout_annotation(&self, label: &str) -> Option<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.popout_annotations.get(label).cloned()
    }

    /// Register `popout` as a view of `parent`'s project showing the **log preview**.
    ///
    /// The preview is app-wide content but still a view of a project (ADR-11), so it keeps
    /// the parent alias — that is what routes its commands and closes it with the window it
    /// was opened from — while its own marker set keeps it out of every project-listing
    /// surface.
    pub fn add_log_popout(&self, popout: &str, parent: &str) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.aliases.insert(popout.to_string(), parent.to_string());
        inner.log_popouts.insert(popout.to_string());
    }

    /// Whether `label` shows the log preview (its frontend asks this to pick its view).
    pub fn popout_log(&self, label: &str) -> bool {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.log_popouts.contains(label)
    }

    /// The open log preview, if there is one. The preview is a **singleton** for the whole
    /// app, so the lookup spans projects rather than resolving one.
    pub fn log_popout(&self) -> Option<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.log_popouts.iter().next().cloned()
    }

    /// Every window of `label`'s project: the owning (root) window plus any popout
    /// windows aliased to it. Used to broadcast UI-state changes to all its views.
    pub fn project_windows(&self, label: &str) -> Vec<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let root = resolve_root(&inner.aliases, label);
        let mut windows = vec![root.clone()];
        for (popout, parent) in &inner.aliases {
            if parent == &root {
                windows.push(popout.clone());
            }
        }
        windows
    }

    /// The popout windows owned by `label` (for closing them with their parent).
    pub fn popouts_of(&self, label: &str) -> Vec<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner
            .aliases
            .iter()
            .filter(|(_, parent)| parent.as_str() == label)
            .map(|(popout, _)| popout.clone())
            .collect()
    }

    /// The popout window showing `tool` for `label`'s project, if one is open.
    ///
    /// Used to **raise** an already-popped-out tool instead of opening a duplicate
    /// tab for it (the "no duplicate analyzer tabs" rule).
    pub fn popout_for(&self, label: &str, tool: ToolId) -> Option<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        popout_showing(&inner, label, &inner.popout_tools, &tool)
    }

    /// The popout window showing `annotation_id` for `label`'s project, if one is open.
    ///
    /// Like [`WindowRegistry::popout_for`] for tools: an annotation that already has a window
    /// is **raised** instead of opened twice.
    pub fn annotation_popout_for(&self, label: &str, annotation_id: &str) -> Option<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        popout_showing(&inner, label, &inner.popout_annotations, annotation_id)
    }

    /// Whether `label` is a popout of any kind (tool or annotation), rather than a project
    /// window: a popout has an alias entry, a project window does not.
    pub fn is_popout(&self, label: &str) -> bool {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.aliases.contains_key(label)
    }

    /// The tools popped out of `label`'s project (for saving/restoring them).
    pub fn popout_tools_of(&self, label: &str) -> Vec<ToolId> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner
            .aliases
            .iter()
            .filter(|(_, parent)| parent.as_str() == label)
            .filter_map(|(popout, _)| inner.popout_tools.get(popout).copied())
            .collect()
    }

    /// Drop a window's state and any aliases it owns or participates in.
    pub fn remove(&self, label: &str) {
        let removed = {
            let mut inner = self
                .inner
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            inner.aliases.remove(label);
            inner.popout_tools.remove(label);
            inner.popout_annotations.remove(label);
            inner.popout_compares.remove(label);
            inner.log_popouts.remove(label);
            inner.aliases.retain(|_, parent| parent != label);
            inner.states.remove(label)
        };
        // Drop the (possibly last) `Arc<WindowState>` **outside** the lock: dropping
        // the last one shuts the window's preview player down (which joins its
        // worker thread), and that must not run while holding the registry lock.
        drop(removed);
    }
}

/// Resolve the calling window's project state.
///
/// Commands take a `WebviewWindow` and look their state up here, so the same
/// command serves every window with the right project (ADR-3).
pub fn window_state<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Arc<WindowState> {
    window
        .app_handle()
        .state::<WindowRegistry>()
        .get(window.label())
}
