//! Finding the running app's endpoint: the advertisement in the MCP settings store, and
//! whether it is live.
//!
//! Split from [`super`] because "where the app publishes itself" (and whether that
//! advertisement can be trusted) is a separate concern from the byte pump.

use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

use crate::mcp::advertise::{self, Advertisement};

/// How long to pause between discovery attempts.
const RETRY_PAUSE: Duration = Duration::from_millis(100);

/// Wait up to `grace` for a **live** app endpoint.
///
/// The advertisement alone is not evidence: a crashed app leaves the store behind, and
/// bridging to that port would fail instead of starting the headless server (audit P2
/// #7). So the recorded pid must be alive and the port must also answer on loopback.
///
/// The store may also **not exist yet** — an MCP client can be launched before the app, or
/// while the app is restarting after an update. Discovery therefore keeps looking for the
/// whole grace period (re-reading the store each attempt, so a rewritten advertisement is
/// picked up) instead of treating one early miss as "no app".
pub fn wait_for_live(grace: Duration) -> bool {
    let Some(path) = advertise::store_path() else {
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
        if let Ok(advert) = read_advertisement_at(path) {
            if is_live(&advert) {
                return true;
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(RETRY_PAUSE);
    }
}

/// Whether an advertisement describes a serving app: it names a bound port, its owner is
/// still alive, and the port accepts a connection.
fn is_live(advert: &Advertisement) -> bool {
    advert.bound_port != 0 && advertise::pid_alive(advert.pid) && probe(advert.bound_port)
}

/// Whether `port` on loopback accepts a connection right now (a short timeout, so a
/// firewall-dropped SYN cannot hang discovery).
fn probe(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

/// Read the advertised endpoint from the app data dir.
pub(super) fn read_advertisement() -> std::io::Result<Advertisement> {
    let path = advertise::store_path().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "could not resolve the app data directory",
        )
    })?;
    read_advertisement_at(&path)
}

/// Read the advertisement at `path` (shared with the bridge's attach loop, which must
/// re-read it when a restarted app has published a new endpoint).
pub(super) fn read_advertisement_at(path: &Path) -> std::io::Result<Advertisement> {
    advertise::read_at(path).map_err(|err| {
        std::io::Error::new(
            err.kind(),
            format!(
                "MCP is off in Hey Listen, or the app isn't running ({})",
                path.display()
            ),
        )
    })
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

    fn write_advertisement(path: &Path, port: u16) {
        let body = format!(
            r#"{{"enabled":true,"port":0,"boundPort":{port},"pid":{},"binary":"{}"}}"#,
            std::process::id(),
            advertise::current_binary().unwrap_or_default()
        );
        std::fs::write(path, body).expect("write");
    }

    /// Publish `path` (pointing at `port`) after `delay`, as a starting app does.
    fn advertise_after(path: std::path::PathBuf, port: u16, delay: Duration) {
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            write_advertisement(&path, port);
        });
    }

    fn temp_store(name: &str) -> std::path::PathBuf {
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

    /// The pre-fix bug: a crashed app left its advertisement behind, and auto mode
    /// committed to bridging to a dead endpoint instead of starting the headless server
    /// (audit P2 #7).
    #[test]
    fn a_stale_advertisement_is_not_live() {
        let path = temp_store("hey_listen_stale_mcp_store.json");
        write_advertisement(&path, closed_port());
        assert!(!live_until(
            &path,
            Instant::now() + Duration::from_millis(250)
        ));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_serving_endpoint_is_live() {
        let (_listener, port) = live_endpoint();
        let path = temp_store("hey_listen_live_mcp_store.json");
        write_advertisement(&path, port);
        assert!(live_until(
            &path,
            Instant::now() + Duration::from_millis(250)
        ));
        let _ = std::fs::remove_file(&path);
    }

    /// An advertisement whose owner is gone must not count, even if the OS handed the
    /// port to another process.
    #[test]
    fn a_dead_owner_is_not_live() {
        let (_listener, port) = live_endpoint();
        let path = temp_store("hey_listen_dead_owner_mcp_store.json");
        std::fs::write(
            &path,
            format!(r#"{{"boundPort":{port},"pid":1,"binary":"/tmp/hey-listen"}}"#),
        )
        .expect("write");
        assert!(!live_until(
            &path,
            Instant::now() + Duration::from_millis(200)
        ));
        let _ = std::fs::remove_file(&path);
    }

    /// Start from `stale` (a dead port) or no file at all, then let a live advertisement
    /// appear shortly after: discovery must still find it within its grace window.
    fn appears_after_a_stale_or_missing_start(path: &Path, stale: Option<u16>) {
        if let Some(port) = stale {
            write_advertisement(path, port);
        }
        let (_listener, port) = live_endpoint();
        advertise_after(path.to_path_buf(), port, Duration::from_millis(250));
        assert!(live_until(path, Instant::now() + Duration::from_secs(3)));
        let _ = std::fs::remove_file(path);
    }

    /// The primary bug: a client launched **before** the app used to see no advertisement
    /// and fall back to headless immediately. Discovery must keep looking for the full
    /// grace window, so an advertisement that appears later still wins.
    #[test]
    fn a_missing_advertisement_is_retried_until_it_appears() {
        let path = temp_store("hey_listen_late_mcp_store.json");
        assert!(!path.exists(), "the test starts with no advertisement");
        appears_after_a_stale_or_missing_start(&path, None);
    }

    /// During a relaunch the store can still describe the previous process (a dead port)
    /// while the new app is coming up; the later, rewritten advertisement must be used.
    #[test]
    fn a_rewritten_advertisement_replaces_a_stale_one() {
        let path = temp_store("hey_listen_rewritten_mcp_store.json");
        appears_after_a_stale_or_missing_start(&path, Some(closed_port()));
    }

    /// `wait_for_live` must spend its grace even when the file is absent at the first
    /// look — the store-path override lets the test use a private path.
    #[test]
    fn wait_for_live_does_not_short_circuit_on_a_missing_file() {
        static ENV: Mutex<()> = Mutex::new(());
        let _guard = ENV.lock().unwrap_or_else(|poison| poison.into_inner());
        let path = temp_store("hey_listen_env_mcp_store.json");
        let previous = std::env::var_os(advertise::STORE_ENV);
        std::env::set_var(advertise::STORE_ENV, &path);

        let (_listener, port) = live_endpoint();
        advertise_after(path.clone(), port, Duration::from_millis(250));
        let live = wait_for_live(Duration::from_secs(3));

        match previous {
            Some(value) => std::env::set_var(advertise::STORE_ENV, value),
            None => std::env::remove_var(advertise::STORE_ENV),
        }
        let _ = std::fs::remove_file(&path);
        assert!(live, "discovery gave up before the advertisement appeared");
    }
}
