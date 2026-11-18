//! The MCP **runtime advertisement**: which loopback port is serving, and which pid owns
//! it — kept in the same `tauri-plugin-store` file as the MCP settings.
//!
//! This replaces the separate `mcp.json` file. One file, one owner
//! ([`super::settings::McpController`]), and the bridge reads exactly the keys the app
//! writes. The advertisement is *runtime* state, not configuration: [`publish`] runs when
//! the server binds, [`withdraw`] when it stops, and [`kill_stale`] makes a relaunch
//! terminate the previous instance that still holds the advertised port.
//!
//! ## Why a pid, and how it is used safely
//!
//! A relaunched app must own the port the bridge is about to use. If the previous process
//! is still alive it keeps the socket, the new instance falls back to another port, and
//! the bridge keeps reading the old advertisement. Before binding, the new instance
//! therefore terminates the recorded pid — but only when it can prove that pid is a Hey
//! Listen instance:
//!
//! - the store is only written by [`super::settings::McpController`] in this app;
//! - the record carries the writer's **executable path** (the sentinel), which must
//!   resolve to this build's own executable;
//! - the record must advertise a bound port (an instance that never served one is not a
//!   competing MCP endpoint);
//! - the pid must differ from this process, and must be alive.
//!
//! A reused pid belonging to an unrelated program therefore cannot be killed: its
//! executable path would not match ours, and even if it did, "same binary path" is the
//! identity the user asked for.

use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

/// The `tauri-plugin-store` file (under the app data dir) holding the MCP settings **and**
/// this runtime advertisement. Also read by the stdio bridge, which has no Tauri context.
pub const STORE_FILE: &str = "mcp-settings.json";

const KEY_BOUND_PORT: &str = "boundPort";
const KEY_PID: &str = "pid";
const KEY_BINARY: &str = "binary";

/// Env override for the store path (used by tests; the app itself resolves it through
/// Tauri, the bridge through [`store_path`]).
pub const STORE_ENV: &str = "HEYLISTEN_MCP_SETTINGS";

/// How long a terminated previous instance gets to exit before it is killed outright.
#[cfg(unix)]
const TERM_GRACE: Duration = Duration::from_secs(1);
/// How often liveness is re-checked during [`TERM_GRACE`].
#[cfg(unix)]
const TERM_POLL: Duration = Duration::from_millis(50);

/// What a running instance publishes. All fields default, so an old settings-only store
/// (or a partially written one) reads as "nothing is advertised".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Advertisement {
    /// The port actually bound; `0` = the server is off.
    #[serde(default)]
    pub bound_port: u16,
    /// The pid that bound it.
    #[serde(default)]
    pub pid: u32,
    /// The executable path of that pid (the identity sentinel).
    #[serde(default)]
    pub binary: Option<String>,
}

/// Read the advertisement through the Tauri store (the app side).
pub fn read<R: Runtime>(app: &AppHandle<R>) -> Advertisement {
    let Ok(store) = app.store(STORE_FILE) else {
        return Advertisement::default();
    };
    Advertisement {
        bound_port: store
            .get(KEY_BOUND_PORT)
            .and_then(|value| value.as_u64())
            .map(|port| port as u16)
            .unwrap_or(0),
        pid: store
            .get(KEY_PID)
            .and_then(|value| value.as_u64())
            .map(|pid| pid as u32)
            .unwrap_or(0),
        binary: store
            .get(KEY_BINARY)
            .and_then(|value| value.as_str().map(str::to_string)),
    }
}

/// Publish the bound port and this process as its owner.
///
/// The listener is already bound when this runs, so a bridge that probes the port after
/// reading the store always finds a listening socket.
pub fn publish<R: Runtime>(app: &AppHandle<R>, port: u16) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|err| format!("could not open the MCP settings store: {err}"))?;
    store.set(KEY_BOUND_PORT, json!(port));
    store.set(KEY_PID, json!(std::process::id()));
    store.set(KEY_BINARY, json!(current_binary()));
    store
        .save()
        .map_err(|err| format!("could not persist the MCP advertisement: {err}"))
}

/// Withdraw the advertisement when the server stops — but only if this process is still
/// the recorded owner. A previous instance shutting down while a newer one already
/// published must not erase the newer instance's endpoint.
///
/// Ownership is read from the **file**, not the store's in-memory cache: a shutting-down
/// instance's cache still names itself long after a new instance has published, and
/// `save()` rewrites the whole cache.
pub fn withdraw<R: Runtime>(app: &AppHandle<R>) {
    let on_disk = tauri_plugin_store::resolve_store_path(app, STORE_FILE)
        .ok()
        .and_then(|path| read_at(&path).ok());
    if on_disk.map(|advert| advert.pid) != Some(std::process::id()) {
        return;
    }
    let Ok(store) = app.store(STORE_FILE) else {
        return;
    };
    store.set(KEY_BOUND_PORT, json!(0));
    store.set(KEY_PID, json!(0));
    if let Err(err) = store.save() {
        log::warn!("could not clear the MCP advertisement: {err}");
    }
}

/// Terminate the previous instance still advertising an endpoint, if there is one.
///
/// Returns the pid that was stopped. The identity check is described in the module doc;
/// a record that does not match this build's executable is ignored (never killed).
pub fn kill_stale<R: Runtime>(app: &AppHandle<R>) -> Option<u32> {
    let advert = read(app);
    let current = current_binary();
    if advert.bound_port == 0
        || advert.pid <= 1
        || advert.pid == std::process::id()
        || !same_binary(advert.binary.as_deref(), current.as_deref())
        || !pid_alive(advert.pid)
    {
        return None;
    }
    terminate(advert.pid).then_some(advert.pid)
}

/// Whether `pid` names a live process.
pub fn pid_alive(pid: u32) -> bool {
    if pid <= 1 {
        return false;
    }
    #[cfg(unix)]
    {
        // Signal 0 only performs the permission/existence check.
        let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
        result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(windows)]
    {
        // `tasklist` exits 0 only when the filter matched a process.
        use std::process::{Command, Stdio};
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .map(|out| {
                out.status.success()
                    && String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
    #[cfg(not(any(unix, windows)))]
    {
        false
    }
}

/// Ask `pid` to exit, then insist. Returns whether it is gone.
fn terminate(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
        if wait_for_exit(pid) {
            return true;
        }
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
        wait_for_exit(pid)
    }
    #[cfg(windows)]
    {
        use std::process::{Command, Stdio};
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

/// Wait up to [`TERM_GRACE`] for `pid` to disappear.
#[cfg(unix)]
fn wait_for_exit(pid: u32) -> bool {
    let mut waited = Duration::ZERO;
    while waited < TERM_GRACE {
        if !pid_alive(pid) {
            return true;
        }
        std::thread::sleep(TERM_POLL);
        waited += TERM_POLL;
    }
    !pid_alive(pid)
}

/// This process's executable path, as the advertisement's sentinel.
pub fn current_binary() -> Option<String> {
    std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

/// Whether the recorded executable is **this** executable (canonicalized when possible).
fn same_binary(recorded: Option<&str>, current: Option<&str>) -> bool {
    match (recorded, current) {
        (Some(recorded), Some(current)) if !recorded.is_empty() => {
            canonical(recorded) == canonical(current)
        }
        _ => false,
    }
}

/// Canonicalize a path, falling back to the string itself when the file is gone (a
/// replaced bundle still matches by path).
fn canonical(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

// --- bridge side -------------------------------------------------------------

/// The store file path for a process without a Tauri app: the app **data** dir (the same
/// directory `tauri-plugin-store` uses) joined with [`STORE_FILE`].
///
/// This is the one place that mirrors Tauri's path resolution; on macOS and Windows it is
/// the platform data dir, on Linux `XDG_DATA_HOME` (not the config dir). [`STORE_ENV`]
/// overrides it.
pub fn store_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(STORE_ENV) {
        return Some(PathBuf::from(path));
    }
    Some(data_dir()?.join(STORE_FILE))
}

/// Read and parse a store file at `path`.
pub fn read_at(path: &Path) -> std::io::Result<Advertisement> {
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(|err| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} is not an MCP settings file: {err}", path.display()),
        )
    })
}

fn data_dir() -> Option<PathBuf> {
    const IDENTIFIER: &str = "com.anvlkv.heylisten";
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join("Library/Application Support")
                .join(IDENTIFIER),
        )
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA")?;
        Some(PathBuf::from(appdata).join(IDENTIFIER))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })?;
        Some(base.join(IDENTIFIER))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str, body: &str) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, body).expect("write");
        path
    }

    /// The bridge reads the same keys the app writes; an old settings-only store reads as
    /// "nothing advertised" rather than failing discovery.
    #[test]
    fn a_settings_only_store_advertises_nothing() {
        let path = temp_store(
            "hey_listen_adv_settings.json",
            r#"{"enabled":true,"port":47100}"#,
        );
        let advert = read_at(&path).expect("parse");
        assert_eq!(advert.bound_port, 0);
        assert_eq!(advert.pid, 0);
        assert!(advert.binary.is_none());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_published_endpoint_round_trips() {
        let path = temp_store(
            "hey_listen_adv_runtime.json",
            r#"{"enabled":true,"port":0,"boundPort":57575,"pid":52757,"binary":"/Applications/Hey Listen.app/Contents/MacOS/hey-listen"}"#,
        );
        let advert = read_at(&path).expect("parse");
        assert_eq!(advert.bound_port, 57575);
        assert_eq!(advert.pid, 52757);
        assert_eq!(
            advert.binary.as_deref(),
            Some("/Applications/Hey Listen.app/Contents/MacOS/hey-listen")
        );
        let _ = std::fs::remove_file(&path);
    }

    /// The kill guard is an identity check: only a record naming **this** executable is a
    /// candidate. A different binary (or a missing sentinel) is never killed.
    #[test]
    fn the_identity_check_requires_the_same_binary() {
        assert!(same_binary(
            Some("/tmp/hey-listen"),
            Some("/tmp/hey-listen")
        ));
        assert!(!same_binary(
            Some("/tmp/hey-listen"),
            Some("/tmp/another-app")
        ));
        assert!(!same_binary(Some(""), Some("/tmp/hey-listen")));
        assert!(!same_binary(None, Some("/tmp/hey-listen")));
        assert!(!same_binary(Some("/tmp/hey-listen"), None));
    }

    #[test]
    fn a_wild_pid_is_never_considered_alive() {
        assert!(!pid_alive(0));
        assert!(!pid_alive(1));
    }
}
