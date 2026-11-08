//! File-association / OS-open requests: the pending-path queue and the `.heyl`/audio
//! path filter. Split out of [`super`] for the source-size budget.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::focused_label;
use crate::commands::source::AUDIO_EXTENSIONS;

/// The project's file extension (magic `HEYL`, and `bundle.fileAssociations` in
/// `tauri.conf.json`).
const PROJECT_EXTENSION: &str = "heyl";

// --- file associations / open-file requests ----------------------------------

/// Event carrying opened `.heyl` paths to a running frontend (file association).
pub const OPEN_EVENT: &str = "app:open-project";

/// `.heyl` paths requested before the frontend was ready (command line / macOS
/// `open`). Drained by [`take_pending_open_paths`] — once, by the first window.
#[derive(Default)]
pub struct OpenedFiles {
    pending: Mutex<Vec<String>>,
    /// Set once the first frontend has drained the queue, so later windows (a new
    /// project window) don't re-open paths that were already handled.
    drained: AtomicBool,
}

/// Paths the OS delivered before `setup` ran. macOS hands a cold-launched app the
/// open-documents Apple Event **before** `RunEvent::Ready` (which is when `setup`
/// manages [`OpenedFiles`]), so they cannot be queued in the managed state yet.
/// [`OpenedFiles::adopt_early`] drains this once the state exists.
static EARLY_OPEN_PATHS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Queue a path unless it is already queued (the OS may repeat a request).
fn queue_unique(queue: &mut Vec<String>, path: String) {
    if !queue.iter().any(|existing| existing == &path) {
        queue.push(path);
    }
}

impl OpenedFiles {
    fn queue(&self, path: String) {
        let mut guard = self
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        queue_unique(&mut guard, path);
    }

    /// Move paths that arrived before this state existed into the queue.
    pub fn adopt_early(&self) {
        let mut early = EARLY_OPEN_PATHS
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut guard = self
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        for path in early.drain(..) {
            queue_unique(&mut guard, path);
        }
    }

    fn take(&self) -> Vec<String> {
        if self.drained.swap(true, Ordering::SeqCst) {
            return Vec::new();
        }
        std::mem::take(
            &mut *self
                .pending
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()),
        )
    }
}

/// Drain the pending open-file requests (the frontend calls this on startup).
#[tauri::command]
pub fn take_pending_open_paths(state: State<'_, OpenedFiles>) -> Vec<String> {
    state.take()
}

/// Remember a project file as recently used and refresh the File → Open Recent menu.
///
/// Writes the recent list to disk and rebuilds the native menu; async so the file
/// write runs on the async runtime rather than the main thread (the menu rebuild
/// hops to the main thread itself).
#[tauri::command]
pub async fn add_recent_project(app: AppHandle, path: String) {
    crate::recent::record(&app, &path);
    let _ = crate::menu::rebuild(&app);
}

/// Queue file-open requests and notify a running frontend. Paths are queued so a
/// request that arrives before the frontend is listening is not lost; once windows
/// exist, the request is routed to the focused one (multi-window, M7).
pub fn handle_open_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    // Queue for the first frontend to drain (cold start / before any window listens).
    // On a cold launch the OS can deliver the request before `setup` manages this
    // state — `state()` would panic (and `panic = "abort"` turns that into SIGABRT),
    // so fall back to the process-level queue `setup` adopts.
    match app.try_state::<OpenedFiles>() {
        Some(state) => {
            for path in &paths {
                state.queue(path.clone());
            }
        }
        None => {
            let mut early = EARLY_OPEN_PATHS
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            for path in &paths {
                queue_unique(&mut early, path.clone());
            }
        }
    }
    // If a window already exists, also route the request to the focused one.
    if let Some(label) = focused_label(app) {
        let _ = app.emit_to(label, OPEN_EVENT, paths);
    }
}

/// `.heyl` or supported audio paths among command-line arguments (Windows/Linux
/// file association).
pub fn opened_paths_from_args(args: impl Iterator<Item = String>) -> Vec<String> {
    args.skip(1).filter(|arg| is_openable_path(arg)).collect()
}

/// `.heyl` / audio paths among macOS `open` URLs.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub fn opened_paths_from_urls(urls: Vec<tauri::Url>) -> Vec<String> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .filter(|path| is_openable_path(path))
        .collect()
}

/// A path the OS can ask us to open: a `.heyl` project or a supported audio file
/// (audio files open as a fresh project with that file as the source).
fn is_openable_path(path: &str) -> bool {
    has_extension(path, &[PROJECT_EXTENSION]) || has_extension(path, AUDIO_EXTENSIONS)
}

fn has_extension(path: &str, extensions: &[&str]) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| extensions.iter().any(|want| ext.eq_ignore_ascii_case(want)))
        .unwrap_or(false)
}
