//! The endpoint the running app advertises (`mcp.json`), and whether it is live.
//!
//! Split from [`super`] because "where the app publishes itself" (and whether that
//! advertisement can be trusted) is a separate concern from the byte pump.

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::mcp::INFO_FILE;

/// The endpoint the running app advertises.
#[derive(Debug, Deserialize)]
pub(super) struct Info {
    pub(super) port: u16,
    pub(super) token: String,
}

/// How long to pause between discovery attempts.
const RETRY_PAUSE: Duration = Duration::from_millis(100);

/// Wait up to `grace` for a **live** app endpoint.
///
/// The advertisement file alone is not evidence: a crashed app leaves `mcp.json` behind,
/// and bridging to that port would fail instead of starting the headless server
/// (audit P2 #7). So the file must also answer on loopback. Returns `true` when a
/// connection succeeds before the deadline.
///
/// The file may also **not exist yet** — an MCP client can be launched before the app, or
/// while the app is restarting after an update. Discovery therefore keeps looking for the
/// whole grace period (re-reading the file each attempt, so a rewritten advertisement is
/// picked up) instead of treating one early miss as "no app".
pub fn wait_for_live(grace: Duration) -> bool {
    let Some(path) = info_path() else {
        return false;
    };
    live_until(&path, Instant::now() + grace)
}

/// Whether the endpoint advertised in `path` accepts a connection before `deadline`.
///
/// The file is re-read on every attempt: it may be missing (the app has not started),
/// half-written, or stale (the previous process) while the app is being replaced.
fn live_until(path: &Path, deadline: Instant) -> bool {
    loop {
        if let Ok(info) = read_info_at(path) {
            if probe(info.port) {
                return true;
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(RETRY_PAUSE);
    }
}

/// Whether `port` on loopback accepts a connection right now (a short timeout, so a
/// firewall-dropped SYN cannot hang discovery).
fn probe(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

/// Read the advertised endpoint from the app data dir.
pub(super) fn read_info() -> std::io::Result<Info> {
    let path = info_path().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "could not resolve the app data directory",
        )
    })?;
    read_info_at(&path)
}

/// Read the advertisement at `path` (shared with the bridge's attach loop, which must
/// re-read it when a handshake is rejected by a restarted app).
pub(super) fn read_info_at(path: &Path) -> std::io::Result<Info> {
    let bytes = std::fs::read(path).map_err(|err| {
        std::io::Error::new(
            err.kind(),
            format!(
                "MCP is off in Hey Listen, or the app isn't running ({}) ",
                path.display()
            ),
        )
    })?;
    serde_json::from_slice(&bytes).map_err(|err| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} is not valid: {err}", path.display()),
        )
    })
}

/// The app's **data** directory + [`INFO_FILE`] (the server advertises there now, so
/// the setting lives alongside the `tauri-plugin-store` file).
///
/// The bridge is not a Tauri app, so it mirrors Tauri's `app_data_dir()` (the
/// platform data dir joined with the bundle identifier) — which differs from the
/// config dir on Linux (`~/.local/share` vs `~/.config`); on macOS and Windows the
/// two resolve to the same path for this identifier. `HEYLISTEN_MCP_INFO` overrides
/// the path (used by tests).
fn info_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HEYLISTEN_MCP_INFO") {
        return Some(PathBuf::from(path));
    }
    Some(data_dir()?.join(INFO_FILE))
}

fn data_dir() -> Option<PathBuf> {
    let identifier = "com.anvlkv.heylisten";
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join("Library/Application Support")
                .join(identifier),
        )
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA")?;
        Some(PathBuf::from(appdata).join(identifier))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })?;
        Some(base.join(identifier))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::Mutex;

    /// A port with nothing listening on it (bind, then release it).
    fn closed_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.local_addr().expect("address").port()
    }

    fn write_info(path: &Path, port: u16) {
        std::fs::write(path, format!("{{\"port\":{port},\"token\":\"t\"}}")).expect("write");
    }

    /// Publish `path` (pointing at `port`) after `delay`, as a starting app does.
    fn advertise_after(path: PathBuf, port: u16, delay: Duration) {
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            write_info(&path, port);
        });
    }

    fn temp_info(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        let _ = std::fs::remove_file(&path);
        path
    }

    /// A bound, listening port. The listener is returned so the test keeps it alive (a
    /// dropped listener would leave the port closed).
    fn live_endpoint() -> (TcpListener, u16) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("address").port();
        (listener, port)
    }

    /// The pre-fix bug: a crashed app left `mcp.json` behind, and auto mode committed to
    /// bridging to a dead endpoint instead of starting the headless server (audit P2 #7).
    #[test]
    fn a_stale_advertisement_is_not_live() {
        let path = temp_info("hey_listen_stale_mcp.json");
        write_info(&path, closed_port());
        assert!(!live_until(
            &path,
            Instant::now() + Duration::from_millis(250)
        ));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_serving_endpoint_is_live() {
        let (_listener, port) = live_endpoint();
        let path = temp_info("hey_listen_live_mcp.json");
        write_info(&path, port);
        assert!(live_until(
            &path,
            Instant::now() + Duration::from_millis(250)
        ));
        let _ = std::fs::remove_file(&path);
    }

    /// Start from `stale` (a dead port) or no file at all, then let a live advertisement
    /// appear shortly after: discovery must still find it within its grace window.
    fn appears_after_a_stale_or_missing_start(path: &Path, stale: Option<u16>) {
        if let Some(port) = stale {
            write_info(path, port);
        }
        let (_listener, port) = live_endpoint();
        advertise_after(path.to_path_buf(), port, Duration::from_millis(250));
        assert!(live_until(path, Instant::now() + Duration::from_secs(3)));
        let _ = std::fs::remove_file(path);
    }

    /// The primary bug: a client launched **before** the app used to see no `mcp.json` and
    /// fall back to headless immediately. Discovery must keep looking for the full grace
    /// window, so an advertisement that appears later still wins.
    #[test]
    fn a_missing_advertisement_is_retried_until_it_appears() {
        let path = temp_info("hey_listen_late_mcp.json");
        assert!(!path.exists(), "the test starts with no advertisement");
        appears_after_a_stale_or_missing_start(&path, None);
    }

    /// During a relaunch the file can still describe the previous process (a dead port)
    /// while the new app is coming up; the later, rewritten advertisement must be used.
    #[test]
    fn a_rewritten_advertisement_replaces_a_stale_one() {
        let path = temp_info("hey_listen_rewritten_mcp.json");
        appears_after_a_stale_or_missing_start(&path, Some(closed_port()));
    }

    /// `wait_for_live` must spend its grace even when the file is absent at the first
    /// look — the `HEYLISTEN_MCP_INFO` override lets the test use a private path.
    #[test]
    fn wait_for_live_does_not_short_circuit_on_a_missing_file() {
        static ENV: Mutex<()> = Mutex::new(());
        let _guard = ENV.lock().unwrap_or_else(|poison| poison.into_inner());
        let path = temp_info("hey_listen_env_mcp.json");
        let previous = std::env::var_os("HEYLISTEN_MCP_INFO");
        std::env::set_var("HEYLISTEN_MCP_INFO", &path);

        let (_listener, port) = live_endpoint();
        advertise_after(path.clone(), port, Duration::from_millis(250));
        let live = wait_for_live(Duration::from_secs(3));

        match previous {
            Some(value) => std::env::set_var("HEYLISTEN_MCP_INFO", value),
            None => std::env::remove_var("HEYLISTEN_MCP_INFO"),
        }
        let _ = std::fs::remove_file(&path);
        assert!(live, "discovery gave up before the advertisement appeared");
    }
}
