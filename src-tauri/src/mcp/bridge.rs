//! The stdio ⇄ localhost bridge (`heylisten-mcp`, or `hey-listen --mcp`).
//!
//! MCP clients launch a local server as a `command` + `args` and
//! speak MCP over its stdio. The actual server lives in the running Hey Listen
//! process (so agent calls drive the user's window), so this bridge is a dumb byte
//! pump: it reads the advertised endpoint from [`INFO_FILE`], connects, sends the
//! token, and forwards bytes both ways.

use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::INFO_FILE;

/// How long to wait for the app to advertise itself before giving up.
const DISCOVER_TIMEOUT: Duration = Duration::from_secs(15);

/// How long to wait for the stdin forwarding thread after the socket closes. A normal MCP
/// client keeps stdin open, so that thread can stay blocked in `read` forever; the bridge
/// must not wait for it (audit P2 #9).
const STDIN_GRACE: Duration = Duration::from_millis(500);

/// The endpoint the running app advertises.
#[derive(Debug, Deserialize)]
struct Info {
    port: u16,
    token: String,
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

/// Run the bridge until stdin or the socket closes.
pub fn run() -> std::io::Result<()> {
    let info = discover()?;
    let stream = connect(info.port)?;
    pump(stream, &info.token, std::io::stdin(), std::io::stdout())
}

/// Pump bytes both ways between `stdin`/`stdout` and the app's socket, sending `token`
/// as the first line.
fn pump(
    stream: TcpStream,
    token: &str,
    stdin: impl Read + Send + 'static,
    mut stdout: impl Write,
) -> std::io::Result<()> {
    stream.set_nodelay(true)?;
    let mut writer = stream.try_clone()?;

    // The token is the connection's first line (the server rejects a mismatch).
    writer.write_all(token.as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()?;

    // stdin → socket. Closing our write half on EOF tells the server the session
    // ended, which lets it return cleanly while the reader drains any last reply.
    let (upstream_done, upstream_finished) = std::sync::mpsc::channel();
    let _upstream = std::thread::Builder::new()
        .name("mcp-stdin".into())
        .spawn(move || {
            let mut stdin = stdin;
            let mut buffer = [0u8; 8192];
            loop {
                match stdin.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if writer.write_all(&buffer[..read]).is_err() {
                            break;
                        }
                    }
                }
            }
            let _ = writer.shutdown(Shutdown::Write);
            let _ = upstream_done.send(());
        })?;

    // socket → stdout.
    let mut reader = stream;
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                stdout.write_all(&buffer[..read])?;
                stdout.flush()?;
            }
        }
    }

    // Wait briefly for the stdin reader (it ends on EOF), but never indefinitely: the app
    // closed the socket while the client still holds stdin open, so the reader is blocked
    // in `read` and the bridge would hang (audit P2 #9).
    let _ = upstream_finished.recv_timeout(STDIN_GRACE);
    Ok(())
}

/// Read the advertised endpoint, waiting briefly for the app to publish it (the
/// server may be added while the app is still starting).
fn discover() -> std::io::Result<Info> {
    let deadline = Instant::now() + DISCOVER_TIMEOUT;
    loop {
        match read_info() {
            Ok(info) => return Ok(info),
            Err(err) if Instant::now() < deadline => {
                // Keep waiting: the app is probably still starting up.
                let _ = err;
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(err) => return Err(err),
        }
    }
}

fn read_info() -> std::io::Result<Info> {
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

/// Connect to the advertised port, retrying briefly (the listener may be a moment
/// behind the file write).
fn connect(port: u16) -> std::io::Result<TcpStream> {
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match TcpStream::connect_timeout(&address, Duration::from_secs(2)) {
            Ok(stream) => return Ok(stream),
            Err(err) if Instant::now() < deadline => {
                let _ = err;
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(err) => {
                return Err(std::io::Error::new(
                    err.kind(),
                    format!("could not connect to Hey Listen on 127.0.0.1:{port}: {err}"),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

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

    /// A client that keeps stdin open must not keep the bridge alive after the app closes
    /// its socket (audit P2 #9).
    #[test]
    fn the_pump_returns_after_the_socket_closes_with_stdin_open() {
        struct BlockedStdin;
        impl Read for BlockedStdin {
            fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
                std::thread::sleep(Duration::from_secs(30));
                Ok(0)
            }
        }

        #[derive(Clone)]
        struct Sink(Arc<Mutex<Vec<u8>>>);
        impl Write for Sink {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.lock().expect("sink").extend_from_slice(bytes);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("address");
        let app = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(stream.try_clone().expect("clone"));
            let mut hello = String::new();
            reader.read_line(&mut hello).expect("handshake");
            assert_eq!(hello.trim(), "token");
            stream
                .try_clone()
                .expect("clone")
                .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n")
                .expect("reply");
            stream
                .shutdown(Shutdown::Both)
                .expect("the app closes the session");
        });

        let socket = TcpStream::connect(address).expect("connect");
        let sink = Sink(Arc::new(Mutex::new(Vec::new())));
        let started = Instant::now();
        pump(socket, "token", BlockedStdin, sink.clone()).expect("pump");
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "the bridge waited for the blocked stdin reader"
        );
        assert!(String::from_utf8_lossy(&sink.0.lock().expect("sink")).contains("result"));
        app.join().expect("app thread");
    }
}
