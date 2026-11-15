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

/// Wait up to `grace` for a **live** app endpoint.
///
/// The advertisement file alone is not evidence: a crashed app leaves `mcp.json` behind,
/// and bridging to that port would fail instead of starting the headless server
/// (audit P2 #7). So the file must also answer on loopback. Returns `true` when a
/// connection succeeds before the deadline.
pub fn wait_for_live(grace: Duration) -> bool {
    info_path()
        .filter(|path| path.exists())
        .is_some_and(|path| live_at(&path, grace))
}

/// Whether the endpoint advertised in `path` accepts a connection within `grace`.
fn live_at(path: &Path, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        if let Ok(info) = read_info_at(path) {
            if probe(info.port) {
                return true;
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
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

fn read_info_at(path: &Path) -> std::io::Result<Info> {
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

    /// A port with nothing listening on it (bind, then release it).
    fn closed_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.local_addr().expect("address").port()
    }

    fn write_info(path: &Path, port: u16) {
        std::fs::write(path, format!("{{\"port\":{port},\"token\":\"t\"}}")).expect("write");
    }

    /// The pre-fix bug: a crashed app left `mcp.json` behind, and auto mode committed to
    /// bridging to a dead endpoint instead of starting the headless server (audit P2 #7).
    #[test]
    fn a_stale_advertisement_is_not_live() {
        let path = std::env::temp_dir().join("hey_listen_stale_mcp.json");
        write_info(&path, closed_port());
        assert!(!live_at(&path, Duration::from_millis(250)));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_serving_endpoint_is_live() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("address").port();
        let path = std::env::temp_dir().join("hey_listen_live_mcp.json");
        write_info(&path, port);
        assert!(live_at(&path, Duration::from_millis(250)));
        let _ = std::fs::remove_file(&path);
    }
}
