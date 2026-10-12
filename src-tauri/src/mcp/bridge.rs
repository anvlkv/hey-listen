//! The stdio ⇄ localhost bridge (`heylisten-mcp`, or `hey-listen --mcp`).
//!
//! Zed and other MCP clients launch a local server as a `command` + `args` and
//! speak MCP over its stdio. The actual server lives in the running Hey Listen
//! process (so agent calls drive the user's window), so this bridge is a dumb byte
//! pump: it reads the advertised endpoint from [`INFO_FILE`], connects, sends the
//! token, and forwards bytes both ways.

use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::INFO_FILE;

/// How long to wait for the app to advertise itself before giving up.
const DISCOVER_TIMEOUT: Duration = Duration::from_secs(15);

/// The endpoint the running app advertises.
#[derive(Debug, Deserialize)]
struct Info {
    port: u16,
    token: String,
}

/// Run the bridge until stdin or the socket closes.
pub fn run() -> std::io::Result<()> {
    let info = discover()?;
    let stream = connect(info.port)?;
    stream.set_nodelay(true)?;
    let mut writer = stream.try_clone()?;

    // The token is the connection's first line (the server rejects a mismatch).
    writer.write_all(info.token.as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()?;

    // stdin → socket. Closing our write half on EOF tells the server the session
    // ended, which lets it return cleanly while the reader drains any last reply.
    let upstream = std::thread::Builder::new()
        .name("mcp-stdin".into())
        .spawn(move || {
            let stdin = std::io::stdin();
            let mut handle = stdin.lock();
            let mut buffer = [0u8; 8192];
            loop {
                match handle.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if writer.write_all(&buffer[..read]).is_err() {
                            break;
                        }
                    }
                }
            }
            let _ = writer.shutdown(Shutdown::Write);
        })?;

    // socket → stdout.
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    let mut reader = stream;
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                output.write_all(&buffer[..read])?;
                output.flush()?;
            }
        }
    }

    let _ = upstream.join();
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
            "could not resolve the app config directory",
        )
    })?;
    let bytes = std::fs::read(&path).map_err(|err| {
        std::io::Error::new(
            err.kind(),
            format!(
                "{} is not there yet (is Hey Listen running?)",
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

/// The app's config directory + [`INFO_FILE`].
///
/// The bridge is not a Tauri app, so it mirrors Tauri's `app_config_dir()` (the
/// platform config dir joined with the bundle identifier). `HEYLISTEN_MCP_INFO`
/// overrides the path (used by tests).
fn info_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HEYLISTEN_MCP_INFO") {
        return Some(PathBuf::from(path));
    }
    Some(config_dir()?.join(INFO_FILE))
}

fn config_dir() -> Option<PathBuf> {
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
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
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
