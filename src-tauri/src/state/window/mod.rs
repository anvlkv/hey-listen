//! Per-window state (one window = one project = one source, ADR-3).
//!
//! Every project window owns its own [`WindowState`]; [`WindowRegistry`] maps a window
//! label onto it, following popout aliases so a popout is a **view** of its parent
//! project rather than a project of its own (ADR-11). See `docs/decisions.md`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::audio::capture::CaptureHandle;

use super::AudioState;

mod compare;

pub use compare::CompareView;

// ---------------------------------------------------------------------------
// Per-window state (one window = one project = one source, ADR-3)
// ---------------------------------------------------------------------------

/// The core state that belongs to a single project window: the owned source PCM
/// (ADR-9), the active filter graph, the preview player, and at most one live
/// capture session.
///
/// Each window gets its own instance, so independent project windows never share
/// audio — see [`WindowRegistry`].
pub struct WindowState {
    pub audio: AudioState,
    /// The window's running capture session (mic / system / process / mix).
    pub capture: Mutex<Option<CaptureHandle>>,
    /// The project's shared **UI state** (timeline window/view, analysis params,
    /// per-tool options and chart views, project name, popped-out tools). The
    /// The frontend owns the shape; the core just stores and broadcasts it, so every
    /// window of a project (the main window and its popouts) stays in sync.
    pub ui: Mutex<HashMap<String, serde_json::Value>>,
    /// Bumped on every UI-state change, so a peer comparison can tell that a project
    /// moved without polling its whole setup (M25).
    ui_revision: AtomicU64,
}

impl WindowState {
    fn new() -> Self {
        Self {
            audio: AudioState::new(),
            capture: Mutex::new(None),
            ui: Mutex::new(HashMap::new()),
            ui_revision: AtomicU64::new(0),
        }
    }

    /// Apply a UI-state patch; returns `true` when the value actually changed.
    pub fn set_ui(&self, key: &str, value: serde_json::Value) -> bool {
        let mut ui = self.ui.lock().unwrap_or_else(|poison| poison.into_inner());
        if ui.get(key) == Some(&value) {
            return false;
        }
        ui.insert(key.to_string(), value);
        self.ui_revision.fetch_add(1, Ordering::Relaxed);
        true
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
/// Created lazily on first use and dropped when the window is destroyed (which
/// also shuts the window's preview player down). This is what makes multiple
/// project windows independent: each label resolves to its own [`WindowState`],
/// while the app-wide stores (recent projects, pending open files) stay shared.
///
/// Popout windows are **views** of a project, not projects of their own: their
/// label is aliased to the parent's, so every command resolves to the parent's
/// [`WindowState`] (the shared source / filter / playback). The alias also records
/// which tool or note the popout shows.
#[derive(Default)]
struct RegistryInner {
    states: HashMap<String, Arc<WindowState>>,
    /// Popout label → parent label (a popout shares its parent's project state).
    aliases: HashMap<String, String>,
    /// Popout label → tool id shown in that popout.
    popout_tools: HashMap<String, String>,
    /// Popout label → note id shown in that popout.
    popout_notes: HashMap<String, String>,
    /// Popout label → the **compare** view it shows (M25). Kept apart from the tool
    /// map so a compare popout is never saved, restored or raised as a tool popout.
    popout_compares: HashMap<String, CompareView>,
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
    pub fn add_popout(&self, popout: &str, parent: &str, tool: &str) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.aliases.insert(popout.to_string(), parent.to_string());
        inner
            .popout_tools
            .insert(popout.to_string(), tool.to_string());
    }

    /// The tool a popout window shows, or `None` for a regular project window.
    pub fn popout_tool(&self, label: &str) -> Option<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.popout_tools.get(label).cloned()
    }

    /// Register `popout` as a view of `parent`'s project showing the note `note_id`.
    pub fn add_note_popout(&self, popout: &str, parent: &str, note_id: &str) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.aliases.insert(popout.to_string(), parent.to_string());
        inner
            .popout_notes
            .insert(popout.to_string(), note_id.to_string());
    }

    /// The note a popout window shows, or `None` for a tool popout / project window.
    pub fn popout_note(&self, label: &str) -> Option<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.popout_notes.get(label).cloned()
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
    pub fn popout_for(&self, label: &str, tool: &str) -> Option<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        popout_showing(&inner, label, &inner.popout_tools, tool)
    }

    /// The popout window showing `note_id` for `label`'s project, if one is open.
    ///
    /// Like [`WindowRegistry::popout_for`] for tools: a note that already has a window
    /// is **raised** instead of opened twice.
    pub fn note_popout_for(&self, label: &str, note_id: &str) -> Option<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        popout_showing(&inner, label, &inner.popout_notes, note_id)
    }

    /// Whether `label` is a popout of any kind (tool or note), rather than a project
    /// window: a popout has an alias entry, a project window does not.
    pub fn is_popout(&self, label: &str) -> bool {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.aliases.contains_key(label)
    }

    /// The tools popped out of `label`'s project (for saving/restoring them).
    pub fn popout_tools_of(&self, label: &str) -> Vec<String> {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner
            .aliases
            .iter()
            .filter(|(_, parent)| parent.as_str() == label)
            .filter_map(|(popout, _)| inner.popout_tools.get(popout).cloned())
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
            inner.popout_notes.remove(label);
            inner.popout_compares.remove(label);
            inner.aliases.retain(|_, parent| parent != label);
            inner.states.remove(label)
        };
        // Drop the (possibly last) `Arc<WindowState>` **outside** the lock: dropping
        // the last one shuts the window's preview player down (which joins its
        // worker thread), and that must not run while holding the registry lock.
        drop(removed);
    }
}

/// Follow the popout alias chain to the owning (project) window label.
fn resolve_root(aliases: &HashMap<String, String>, label: &str) -> String {
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

/// The popout of `label`'s project whose `shown` table (popout label → shown id) maps
/// it to `id`, if one is open. `shown` is the tool map or the note map, so the two
/// kinds share one lookup.
fn popout_showing(
    inner: &RegistryInner,
    label: &str,
    shown: &HashMap<String, String>,
    id: &str,
) -> Option<String> {
    let root = resolve_root(&inner.aliases, label);
    inner.aliases.iter().find_map(|(popout, parent)| {
        let same_project = resolve_root(&inner.aliases, parent) == root;
        let shows_id = shown.get(popout).map(String::as_str) == Some(id);
        (same_project && shows_id).then(|| popout.clone())
    })
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
