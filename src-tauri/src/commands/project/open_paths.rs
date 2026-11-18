//! File-association / OS-open requests: the pending-path queue and the `.heyl`/audio
//! path filter. Split out of [`super`] for the source-size budget.

use std::path::Path;
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

/// `.heyl` paths requested before the frontend could take them (command line / macOS
/// `open`). Drained by [`take_pending_open_paths`] whenever a window asks.
///
/// The queue is **re-drainable** on purpose. A request can arrive after a window's first
/// drain yet before (or while) that window is listening; the OS-open path also delivers
/// with a fire-and-forget `emit`. Leaving a late request queued means the next drain — a
/// window focus, a new window — still opens it, where a one-shot drain would drop it for
/// the rest of the process's life (the `.heyl` open regression).
#[derive(Default)]
pub struct OpenedFiles {
    pending: Mutex<Vec<String>>,
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
    let paths = state.take();
    // An OS-open that never reaches the frontend leaves no other trace: say that it was
    // claimed, so a bug report can tell "never delivered" from "delivered and ignored".
    if !paths.is_empty() {
        log::info!("opening {} queued path(s)", paths.len());
    }
    paths
}

/// Remember a project file as recently used and refresh the File → Open Recent menu.
///
/// Writes the recent list to disk and rebuilds the native menu; async so the file
/// write runs on the async runtime rather than the main thread (the menu rebuild
/// hops to the main thread itself).
#[tauri::command]
pub async fn add_recent_project(app: AppHandle, path: String) {
    crate::recent::record(&app, &path);
    // A failed rebuild leaves File → Open Recent stale until the next change, which is
    // otherwise a silent no-op.
    if let Err(err) = crate::menu::rebuild(&app) {
        log::warn!("could not rebuild the menu after recording a recent project: {err}");
    }
}

/// Queue file-open requests and notify a running frontend. Paths are queued so a
/// request that arrives before the frontend is listening is not lost; once windows
/// exist, the request is routed to the focused one (multi-window, M7).
pub fn handle_open_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    log::info!("OS/file-association open request: {}", paths.join(", "));
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
    // A window may already be listening — and if it is not yet, the queued copy above is
    // drained when it is (the frontend also drains on focus, see `state/menu.ts`).
    if let Some(label) = focused_label(app) {
        if let Err(err) = app.emit_to(label.clone(), OPEN_EVENT, paths) {
            log::warn!("could not deliver an open request to {label}: {err}");
        }
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

#[cfg(test)]
mod tests {
    use super::{is_openable_path, OpenedFiles};

    fn path(name: &str) -> String {
        format!("/tmp/{name}")
    }

    /// The regression: a request that arrives **after** the first frontend drained the
    /// queue used to be dropped forever (the drain was one-shot), so double-clicking a
    /// project while the app was coming up could open nothing. It must still be delivered
    /// by the next drain.
    #[test]
    fn a_request_queued_after_a_drain_is_still_delivered() {
        let files = OpenedFiles::default();
        assert!(files.take().is_empty(), "the frontend's startup drain");

        files.queue(path("analysis-example.heyl"));

        assert_eq!(files.take(), vec![path("analysis-example.heyl")]);
        assert!(files.take().is_empty(), "a drained request is not repeated");
    }

    /// The same path requested twice (macOS can repeat an open request) is queued once.
    #[test]
    fn a_repeated_request_is_queued_once() {
        let files = OpenedFiles::default();
        files.queue(path("a.heyl"));
        files.queue(path("a.heyl"));
        assert_eq!(files.take(), vec![path("a.heyl")]);
    }

    #[test]
    fn only_project_and_audio_paths_are_openable() {
        assert!(is_openable_path("/tmp/song.heyl"));
        assert!(is_openable_path("/tmp/song.HEYL"));
        assert!(is_openable_path("/tmp/song.wav"));
        assert!(!is_openable_path("/tmp/notes.txt"));
        assert!(!is_openable_path("/tmp/no-extension"));
    }
}
