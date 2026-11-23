//! The stdio ⇄ localhost bridge (`heylisten-mcp`, or `hey-listen --mcp`).
//!
//! MCP clients launch a local server as a `command` + `args` and
//! speak MCP over its stdio. The actual server lives in the running Hey Listen
//! process (so agent calls drive the user's window), so this bridge is a dumb byte
//! pump: it reads the advertised endpoint (see [`endpoint`]), connects, sends the
//! protocol greeting, and forwards bytes both ways.
//!
//! ## Attaching, and where it ends
//!
//! [`attach`] retries for [`ATTACH_TIMEOUT`] — waiting for the advertisement, its pid and
//! its port — because an MCP client may be launched before the app, or while the app
//! restarts after an update.
//!
//! Once the pump has started the bridge **does not reconnect**. The MCP session state
//! (`initialize`, capabilities, in-flight calls) lives in the app, not here; silently
//! re-attaching to a restarted app would deliver the client's next request to a fresh
//! server that never saw its `initialize`. So when the app's socket closes the bridge
//! returns and exits promptly, and the client relaunches it for the next session.

mod endpoint;
#[cfg(test)]
mod tests;

use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use crate::mcp::HELLO;

pub use endpoint::{app_state, wait_for_live, AppState};

/// How long an attach keeps retrying: for the advertisement to exist, its port to accept,
/// and a rejected handshake to be replaced by the restarted app's endpoint.
const ATTACH_TIMEOUT: Duration = Duration::from_secs(15);

/// One `connect` attempt's budget (also bounded by the attach deadline).
const CONNECT_ATTEMPT: Duration = Duration::from_secs(2);

/// How long to wait between connect attempts.
const CONNECT_RETRY_PAUSE: Duration = Duration::from_millis(100);

/// How long to wait between attach attempts (the app may still be rewriting the store).
const ATTACH_RETRY_PAUSE: Duration = Duration::from_millis(100);

/// How long the bridge waits for the server to reject a handshake.
///
/// A successful handshake is silent (the server sends nothing until we forward a
/// request); a rejected one closes the socket immediately. This is the only way to tell
/// them apart, and it is worth the short wait: see [`handshake`].
const HANDSHAKE_CHECK: Duration = Duration::from_millis(250);

/// How long to wait for the stdin forwarding thread after the socket closes. A normal MCP
/// client keeps stdin open, so that thread can stay blocked in `read` forever; the bridge
/// must not wait for it (audit P2 #9).
const STDIN_GRACE: Duration = Duration::from_millis(500);

/// Connect to the running app and complete the protocol greeting.
///
/// The advertisement can be **stale for a moment** right after the app restarts: the
/// store still describes the previous process, and the kernel often hands the same
/// ephemeral port back, so the connection succeeds and then the peer is not our server
/// (or is the dying one). That used to end the bridge — and with it the client's whole
/// session, whose first request had not even been read from stdin yet. Retrying here is
/// safe precisely because the client's bytes are still buffered in stdin (nothing has
/// been forwarded), and the rejection itself is the signal to re-read the store.
pub fn attach() -> std::io::Result<TcpStream> {
    attach_from(
        Instant::now() + ATTACH_TIMEOUT,
        endpoint::read_advertisement,
    )
}

/// [`attach`] with an explicit deadline and advertisement source (the latter is the test
/// seam for [`endpoint::read_advertisement_at`]).
fn attach_from(
    deadline: Instant,
    mut read: impl FnMut() -> std::io::Result<crate::mcp::advertise::Advertisement>,
) -> std::io::Result<TcpStream> {
    loop {
        let attempt = read().and_then(|advert| {
            let stream = connect_until(advert.bound_port, deadline)?;
            handshake(stream)
        });
        match attempt {
            Ok(stream) => return Ok(stream),
            Err(err) if Instant::now() < deadline => {
                log::warn!("MCP attach attempt failed ({err}); retrying");
                sleep_within(ATTACH_RETRY_PAUSE, deadline);
            }
            Err(err) => return Err(err),
        }
    }
}

/// Sleep for `pause`, but never past `deadline`.
fn sleep_within(pause: Duration, deadline: Instant) {
    std::thread::sleep(pause.min(deadline.saturating_duration_since(Instant::now())));
}

/// Send the greeting and confirm the server kept the session.
///
/// The first line of the connection is [`HELLO`] (the server rejects anything else), after
/// which a healthy server stays silent until it has a response to write. So: peek for a
/// moment — end of stream means the handshake was refused, silence means it was accepted.
/// `peek` never consumes the byte, so a (not expected) early message is still forwarded.
fn handshake(mut stream: TcpStream) -> std::io::Result<TcpStream> {
    stream.set_nodelay(true)?;
    stream.write_all(HELLO.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()?;

    stream.set_read_timeout(Some(HANDSHAKE_CHECK))?;
    let mut probe = [0u8; 1];
    let outcome = match stream.peek(&mut probe) {
        Ok(0) => Err(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "the app refused the handshake (a restarted app?)",
        )),
        Ok(_) => Ok(()),
        Err(err)
            if matches!(
                err.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            ) =>
        {
            Ok(())
        }
        Err(err) => Err(err),
    };
    // The pump reads blocking, without a deadline: the session lives as long as the
    // client holds it.
    stream.set_read_timeout(None)?;
    outcome.map(|()| stream)
}

/// Pump bytes both ways between `stdin`/`stdout` and the app's socket.
fn pump(
    stream: TcpStream,
    stdin: impl Read + Send + 'static,
    mut stdout: impl Write,
) -> std::io::Result<()> {
    stream.set_nodelay(true)?;
    let mut writer = stream.try_clone()?;

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

/// Run the byte pump over the process's real stdio, against an attached app socket.
///
/// Returns when stdin or the socket closes; the caller then exits (see the module doc for
/// why this is not reconnected).
pub fn pump_stdio(stream: TcpStream) -> std::io::Result<()> {
    pump(stream, std::io::stdin(), std::io::stdout())
}

/// Connect to the advertised port, retrying until `deadline` (the listener may be a
/// moment behind the file write, and a restarted app may briefly refuse).
fn connect_until(port: u16, deadline: Instant) -> std::io::Result<TcpStream> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut last: Option<std::io::Error> = None;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match TcpStream::connect_timeout(&address, CONNECT_ATTEMPT.min(remaining)) {
            Ok(stream) => return Ok(stream),
            Err(err) => last = Some(err),
        }
        sleep_within(CONNECT_RETRY_PAUSE, deadline);
    }
    let err = last.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::TimedOut, "the attach deadline passed")
    });
    Err(std::io::Error::new(
        err.kind(),
        format!("could not connect to Hey Listen on 127.0.0.1:{port}: {err}"),
    ))
}
