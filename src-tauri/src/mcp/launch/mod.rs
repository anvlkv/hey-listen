//! Starting the GUI from the stdio entry.
//!
//! An MCP client launches the stdio entry, not the app. Without this module a call made
//! while Hey Listen is closed is quietly served **headless**: `open_project` /
//! `open_project_window` "succeed" with no window to see. So the default entry (not
//! `--headless`) starts the app once when nothing of ours is running, then waits for it to
//! advertise an endpoint (see [`crate::mcp::run`]).
//!
//! Three rules keep that safe:
//!
//! - **Never a second instance.** [`decide`] starts the GUI only when the advertisement
//!   names neither a live endpoint nor a live app process. During an update relaunch the
//!   previous process is gone and the new one has not published yet, so the caller spends
//!   the whole discovery grace first; this module only sees the state *after* it.
//! - **Once per bridge process.** [`Launcher`] latches the attempt, so a failed or slow
//!   start is never retried.
//! - **No GUI, no error.** A helper that cannot find the app binary — or a machine where
//!   the spawn fails — falls back to the headless server instead of failing the call.
//!
//! ## What is launched
//!
//! The stdio entry is either the **app binary in MCP mode** (`hey-listen --mcp`) or the
//! console **helper** (`heylisten-mcp`):
//!
//! - the app binary is spawned again with **no arguments**, which is the GUI entry;
//! - the helper has to find the app: beside itself (the dev `target/*/` pair, or a helper
//!   inside an installed `Contents/MacOS/`), or in the macOS `Applications` folders. Not
//!   found means headless ([`app`] resolves that).
//!
//! macOS starts a bundled app through LaunchServices (`open <bundle>`) so it gets its Dock
//! entry and activation. A bundle that is *this* process (`--mcp`) is spawned directly
//! instead, because `open` would just activate the running MCP-mode instance rather than
//! start a window. Everywhere else the executable is spawned.

mod app;
#[cfg(test)]
mod tests;

use crate::mcp::bridge::{app_state, AppState};

pub use app::AppTarget;

/// The console helper's binary name (its package lives in `src-tauri/mcp/`).
const HELPER_BIN: &str = "heylisten-mcp";

/// The app's binary name (`mainBinaryName` in `tauri.conf.json`).
const APP_BIN: &str = "hey-listen";

/// What the stdio entry does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// An app is serving: bridge to it instead of starting anything.
    Attach,
    /// An app process of ours is alive but not serving yet — starting, or running with
    /// the MCP server switched off. Leave it alone.
    LeaveRunning,
    /// Nothing is running: start the GUI.
    StartGui,
    /// A GUI cannot be started (no app binary, or this process already started it).
    Headless,
}

/// Decide whether the GUI may be started.
///
/// `state` is what the advertisement says now, `started` whether this process already
/// made its one launch attempt, and `target` the app resolved once by
/// [`current_target`] (`None`: the helper found no app binary).
pub fn decide(state: AppState, started: bool, target: Option<&AppTarget>) -> Step {
    match state {
        AppState::Live => Step::Attach,
        AppState::Starting => Step::LeaveRunning,
        AppState::Absent if !started && target.is_some() => Step::StartGui,
        AppState::Absent => Step::Headless,
    }
}

/// The app the stdio entry should start, resolved once per process.
///
/// `None` means there is nothing to start — the helper found no app binary — so the
/// caller serves headless.
pub fn current_target() -> Option<AppTarget> {
    let exe = std::env::current_exe().ok()?;
    if exe.file_stem().is_some_and(|stem| stem == HELPER_BIN) {
        AppTarget::locate(&exe)
    } else {
        // The app binary in MCP mode (`--mcp`): spawning it again without arguments is
        // the GUI entry. Its own bundle is not opened (see the module doc).
        Some(AppTarget::new(exe, false))
    }
}

/// Starts the GUI at most once per bridge process.
pub struct Launcher {
    target: Option<AppTarget>,
    started: bool,
}

impl Launcher {
    pub fn new(target: Option<AppTarget>) -> Self {
        Self {
            target,
            started: false,
        }
    }

    /// Start the GUI when [`decide`] allows it.
    ///
    /// Returns whether an app endpoint is expected — `true` means "wait for it and
    /// attach", `false` means "serve headless now".
    pub fn ensure(&mut self) -> bool {
        let state = match self.target.as_ref() {
            Some(target) => app_state(target.exe()),
            None => AppState::Absent,
        };
        self.ensure_with(state, app::spawn)
    }

    /// [`Self::ensure`] with the advertisement state and the spawn injected (tests).
    fn ensure_with(
        &mut self,
        state: AppState,
        spawn: impl FnOnce(&AppTarget) -> std::io::Result<()>,
    ) -> bool {
        match decide(state, self.started, self.target.as_ref()) {
            // The app answered while this process was deciding: attach to it.
            Step::Attach => true,
            Step::LeaveRunning => {
                log::info!(
                    "MCP: an app process is running but not serving MCP; not starting a second instance"
                );
                false
            }
            Step::StartGui => {
                // Latched before the spawn: a failed launch is not retried either.
                self.started = true;
                let Some(target) = self.target.as_ref() else {
                    return false; // `decide` answers `StartGui` only with a target
                };
                match spawn(target) {
                    Ok(()) => {
                        log::info!(
                            "MCP: started Hey Listen ({}) — waiting for its endpoint",
                            target.exe().display()
                        );
                        true
                    }
                    Err(err) => {
                        log::warn!("MCP: could not start Hey Listen ({err}); serving headless");
                        false
                    }
                }
            }
            Step::Headless => {
                log::debug!("MCP: no app to start; serving headless");
                false
            }
        }
    }
}
