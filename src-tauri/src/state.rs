//! Core-owned audio state.
//!
//! The Rust core owns the PCM backing the timeline (ADR-9): file decodes and synth
//! renders write it, live capture appends to it, and preview playback reads it.
//! The frontend keeps its own copy only for rendering the waveform (a transitional
//! duplication — see `docs/decisions.md` → ADR-9).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::audio::capture::CaptureHandle;
use crate::audio::graph::GraphSpec;
use crate::audio::playback::Playback;

/// The current source's PCM (interleaved `f32`).
#[derive(Debug, Clone)]
pub struct SourcePcm {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Shared state behind the playback/filter source: one per app (one window = one
/// project = one source).
pub struct AudioState {
    /// The source PCM. The `Arc`/`Mutex` lets the capture thread append while the
    /// command layer reads.
    pub source: Arc<Mutex<Option<SourcePcm>>>,
    /// While true, live-capture chunks are appended to `source`.
    pub recording: Arc<AtomicBool>,
    /// The active filter graph, applied before preview (and, from M4, analysis).
    pub filter: Arc<Mutex<Option<GraphSpec>>>,
    pub playback: Playback,
}

/// A cheap, cloneable handle for appending capture chunks from the capture thread
/// without holding the whole [`AudioState`].
#[derive(Clone)]
pub struct RecordingSink {
    source: Arc<Mutex<Option<SourcePcm>>>,
    recording: Arc<AtomicBool>,
}

impl RecordingSink {
    /// Append captured interleaved samples while recording.
    pub fn append(&self, interleaved: &[f32]) {
        if !self.recording.load(Ordering::Relaxed) {
            return;
        }
        let mut guard = self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(source) = guard.as_mut() {
            source.samples.extend_from_slice(interleaved);
        }
    }
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            source: Arc::new(Mutex::new(None)),
            recording: Arc::new(AtomicBool::new(false)),
            filter: Arc::new(Mutex::new(None)),
            playback: Playback::new(),
        }
    }

    /// A handle for appending live-capture chunks from another thread.
    pub fn recording_sink(&self) -> RecordingSink {
        RecordingSink {
            source: self.source.clone(),
            recording: self.recording.clone(),
        }
    }

    /// Replace the source PCM (file decode / synth render).
    pub fn set_source(&self, source: Option<SourcePcm>) {
        self.recording.store(false, Ordering::Relaxed);
        *self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = source;
    }

    /// Replace the filter graph; `None` bypasses filtering.
    pub fn set_filter(&self, spec: Option<GraphSpec>) {
        *self
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = spec;
    }

    /// Begin a fresh recording buffer (called when Record starts).
    pub fn begin_recording(&self, sample_rate: u32, channels: u16) {
        let mut guard = self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        *guard = Some(SourcePcm {
            samples: Vec::new(),
            sample_rate,
            channels,
        });
        self.recording.store(true, Ordering::Relaxed);
    }

    /// Stop appending capture chunks (the recorded audio is kept).
    pub fn end_recording(&self) {
        self.recording.store(false, Ordering::Relaxed);
    }

    /// Drop the source PCM and silence preview (used when the source changes).
    pub fn clear(&self) {
        self.recording.store(false, Ordering::Relaxed);
        *self
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = None;
        self.playback.stop();
    }
}

impl Default for AudioState {
    fn default() -> Self {
        Self::new()
    }
}

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
    /// frontend owns the shape; the core just stores and broadcasts it, so every
    /// window of a project (the main window and its popouts) stays in sync.
    pub ui: Mutex<HashMap<String, serde_json::Value>>,
}

impl WindowState {
    fn new() -> Self {
        Self {
            audio: AudioState::new(),
            capture: Mutex::new(None),
            ui: Mutex::new(HashMap::new()),
        }
    }

    /// Apply a UI-state patch; returns `true` when the value actually changed.
    pub fn set_ui(&self, key: &str, value: serde_json::Value) -> bool {
        let mut ui = self.ui.lock().unwrap_or_else(|poison| poison.into_inner());
        if ui.get(key) == Some(&value) {
            return false;
        }
        ui.insert(key.to_string(), value);
        true
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
/// which tool the popout shows.
#[derive(Default)]
struct RegistryInner {
    states: HashMap<String, Arc<WindowState>>,
    /// Popout label → parent label (a popout shares its parent's project state).
    aliases: HashMap<String, String>,
    /// Popout label → tool id shown in that popout.
    popout_tools: HashMap<String, String>,
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
        let mut current = label.to_string();
        let mut seen = std::collections::HashSet::new();
        while let Some(parent) = inner.aliases.get(&current) {
            if !seen.insert(current.clone()) {
                break;
            }
            current = parent.clone();
        }
        inner
            .states
            .entry(current)
            .or_insert_with(|| Arc::new(WindowState::new()))
            .clone()
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
        let root = resolve_root(&inner.aliases, label);
        inner.aliases.iter().find_map(|(popout, parent)| {
            let same_project = resolve_root(&inner.aliases, parent) == root;
            let same_tool = inner.popout_tools.get(popout).map(String::as_str) == Some(tool);
            (same_project && same_tool).then(|| popout.clone())
        })
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
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        inner.states.remove(label);
        inner.aliases.remove(label);
        inner.popout_tools.remove(label);
        inner.aliases.retain(|_, parent| parent != label);
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
