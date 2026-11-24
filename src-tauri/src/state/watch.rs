//! Live-linked sources: watch the file a project's source came from and tell the project
//! window when it changes.
//!
//! A source can be kept as a **link** to the file it was opened from, so editing that file
//! (a DAW rewriting a bounce) has to reach the open project. The core only **detects** the
//! change and reports it — the frontend re-reads the file in place, which keeps its
//! timeline window, tabs and annotations. One watcher runs per project label, polls
//! `metadata()` (there is no `notify` dependency), and reports a change only once it has
//! stopped moving, because a rewrite lands as a burst of stamps.

use std::collections::HashMap;
use std::fs::Metadata;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// The event a project window listens for when its live-linked source moved.
pub const SOURCE_CHANGED_EVENT: &str = "source-changed";

/// One slice of the poll sleep, so a stopped watcher exits within a quarter second even
/// while its loop is otherwise asleep.
const POLL_SLICE: Duration = Duration::from_millis(250);
/// Slices per poll: one `metadata()` read per second.
const POLL_SLICES: u32 = 4;
/// How long a stamp must hold before it is reported as a change.
const SETTLE: Duration = Duration::from_millis(500);

/// Why a project's live-linked source needs re-reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename_all = "camelCase")]
pub enum SourceWatchReason {
    Changed,
    Missing,
}

/// The payload of [`SOURCE_CHANGED_EVENT`].
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourceWatchEvent {
    pub path: String,
    pub reason: SourceWatchReason,
}

/// The file facts a change is judged on.
///
/// `modified` is `None` when the filesystem reports no modification time (or the platform
/// cannot); the pair still compares on `len`, so a rewrite that only changed the length is
/// a change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    modified: Option<SystemTime>,
    len: u64,
}

impl Stamp {
    /// The stamp of one `metadata()` read.
    fn from_metadata(meta: &Metadata) -> Self {
        Self {
            modified: meta.modified().ok(),
            len: meta.len(),
        }
    }
}

/// The pure change detector for one file: what was last reported, and what is waiting to
/// settle. `observe` takes `now` from its caller, so the tests need no clock and no thread.
#[derive(Debug, Default)]
struct WatchState {
    /// The last reportable stamp; `None` until the first successful read arms the watcher,
    /// because an existing file is not a change.
    last: Option<Stamp>,
    /// A stamp seen but not yet stable.
    pending: Option<Candidate>,
    /// Whether the file is currently reported missing (so one disappearance is one report).
    missing: bool,
}

/// A change waiting for the settle window.
#[derive(Debug, Clone, Copy)]
struct Candidate {
    stamp: Stamp,
    since: Instant,
    /// A restoration returns `Changed` even when its stamp matches the one from before the
    /// file vanished — the frontend has to read the file again either way.
    forced: bool,
}

impl WatchState {
    /// Fold in one poll (`None` = the file could not be read) and report a settled change.
    fn observe(&mut self, current: Option<Stamp>, now: Instant) -> Option<SourceWatchReason> {
        match current {
            None => self.vanish(),
            Some(stamp) => self.settle(stamp, now),
        }
    }

    /// The file could not be read: report `Missing` once, and nothing before the first
    /// successful read (an unknown file has not vanished from anywhere).
    fn vanish(&mut self) -> Option<SourceWatchReason> {
        self.pending = None;
        if self.missing || self.last.is_none() {
            return None;
        }
        self.missing = true;
        Some(SourceWatchReason::Missing)
    }

    /// A successful read: arm the watcher, or report the stamp once it has held still.
    fn settle(&mut self, current: Stamp, now: Instant) -> Option<SourceWatchReason> {
        if self.missing {
            self.missing = false;
            self.pending = Some(Candidate {
                stamp: current,
                since: now,
                forced: true,
            });
            return None;
        }
        let Some(last) = self.last else {
            self.last = Some(current);
            return None;
        };
        if !self.pending.is_some_and(|pending| pending.forced) && last == current {
            // A burst that ended where it began is no change at all.
            self.pending = None;
            return None;
        }
        // A different stamp restarts the settle: only the last write of a burst may report.
        let since = match self.pending {
            Some(pending) if pending.stamp == current => pending.since,
            _ => now,
        };
        self.pending = Some(Candidate {
            stamp: current,
            since,
            forced: false,
        });
        if now.duration_since(since) < SETTLE {
            return None;
        }
        self.last = Some(current);
        self.pending = None;
        Some(SourceWatchReason::Changed)
    }
}

/// One running watcher: the flag its loop checks and the thread it runs on.
struct WatchHandle {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

static WATCHERS: OnceLock<Mutex<HashMap<String, WatchHandle>>> = OnceLock::new();

/// The registry map, initialized on first use.
fn watchers() -> &'static Mutex<HashMap<String, WatchHandle>> {
    WATCHERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Lock the registry, recovering a poisoned one (a panic in a command must not leave the
/// watchers unstoppable).
fn registry() -> MutexGuard<'static, HashMap<String, WatchHandle>> {
    watchers()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

/// Point `label`'s project at the live-linked source `path`, or stop watching it when
/// `path` is `None`.
///
/// Any watcher already registered for the label is replaced, so a re-link never leaves two
/// loops reporting the same project.
pub fn sync(label: &str, path: Option<PathBuf>, app: tauri::AppHandle) {
    stop(label);
    let Some(path) = path else {
        return;
    };
    log::info!("watching the live source {} for {label}", path.display());
    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    let name = format!("source-watch-{label}");
    let target = label.to_string();
    let spawned = std::thread::Builder::new()
        .name(name)
        .spawn(move || run(target, path, app, flag));
    match spawned {
        Ok(thread) => {
            registry().insert(label.to_string(), WatchHandle { stop, thread });
        }
        Err(err) => log::warn!("could not start the source watcher for {label}: {err}"),
    }
}

/// Stop `label`'s watcher, if it has one.
pub fn stop(label: &str) {
    let Some(handle) = registry().remove(label) else {
        return;
    };
    log::info!("stopped watching the live source for {label}");
    halt(handle);
}

/// Stop every watcher (the app is exiting).
pub fn stop_all() {
    let handles: Vec<(String, WatchHandle)> = registry().drain().collect();
    for (label, handle) in handles {
        log::info!("stopped watching the live source for {label}");
        halt(handle);
    }
}

/// Flag a watcher to exit, reaping it only when it has already finished.
///
/// The loop may be inside a slow `metadata()` on a network share, so joining here could
/// hang a source switch (or app exit) for as long as the filesystem takes. The flag ends
/// the thread within one poll slice; dropping the handle detaches a thread still running.
fn halt(handle: WatchHandle) {
    handle.stop.store(true, Ordering::Relaxed);
    if handle.thread.is_finished() {
        let _ = handle.thread.join();
    }
}

/// Poll one file until `stop` is set, reporting each settled change to the project window.
fn run(label: String, path: PathBuf, app: tauri::AppHandle, stop: Arc<AtomicBool>) {
    let mut state = WatchState::default();
    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        if let Some(reason) = state.observe(read(&path), Instant::now()) {
            report(&app, &label, &path, reason);
        }
        for _ in 0..POLL_SLICES {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            std::thread::sleep(POLL_SLICE);
        }
    }
}

/// One poll: `None` when the file cannot be read (gone, or not yet there).
fn read(path: &Path) -> Option<Stamp> {
    std::fs::metadata(path)
        .ok()
        .map(|meta| Stamp::from_metadata(&meta))
}

/// Tell the project window about a settled change.
fn report(app: &tauri::AppHandle, label: &str, path: &Path, reason: SourceWatchReason) {
    let path = path.to_string_lossy().into_owned();
    log::info!("live source {path} for {label}: {reason:?}");
    if let Err(err) = app.emit_to(
        label.to_owned(),
        SOURCE_CHANGED_EVENT,
        SourceWatchEvent { path, reason },
    ) {
        log::warn!("could not report a source change to {label}: {err}");
    }
}

#[cfg(test)]
mod tests;
