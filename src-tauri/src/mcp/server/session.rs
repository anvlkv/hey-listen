//! One MCP session's transport: the handshake, the bounded line reader, and the
//! simultaneous-session cap. Split out of [`super`] for the source-size budget.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use super::super::protocol;

/// The largest handshake line (the token) accepted before authentication, in bytes.
const MAX_HANDSHAKE_LEN: usize = 256;
/// The largest single JSON message (one newline-delimited line) accepted, in bytes.
const MAX_MESSAGE_LEN: usize = 4 * 1024 * 1024;
/// How long a new connection has to present the token before it is dropped.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// How long an authenticated session may sit idle between messages.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// How many sessions may be open at once.
const MAX_SESSIONS: usize = 8;

/// The transport limits one session enforces (a struct so the tests can shrink them).
#[derive(Debug, Clone, Copy)]
struct Limits {
    handshake: Duration,
    idle: Duration,
    max_handshake: usize,
    max_message: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            handshake: HANDSHAKE_TIMEOUT,
            idle: IDLE_TIMEOUT,
            max_handshake: MAX_HANDSHAKE_LEN,
            max_message: MAX_MESSAGE_LEN,
        }
    }
}

/// The simultaneous-session cap. A permit is released when its session thread ends,
/// however it ends.
#[derive(Clone)]
pub(super) struct Sessions {
    open: Arc<AtomicUsize>,
}

impl Sessions {
    pub(super) fn new() -> Self {
        Self {
            open: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Take a slot, or `None` when every session slot is in use.
    pub(super) fn try_enter(&self) -> Option<SessionPermit> {
        let mut current = self.open.load(Ordering::SeqCst);
        loop {
            if current >= MAX_SESSIONS {
                return None;
            }
            match self.open.compare_exchange(
                current,
                current + 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => {
                    return Some(SessionPermit {
                        open: self.open.clone(),
                    })
                }
                Err(next) => current = next,
            }
        }
    }
}

pub(super) struct SessionPermit {
    open: Arc<AtomicUsize>,
}

impl Drop for SessionPermit {
    fn drop(&mut self) {
        self.open.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The transport half of [`serve`], with the tool dispatch injected (unit-testable
/// without a Tauri app).
fn serve_session<D: FnMut(&str, Value) -> Result<Value, String>>(
    stream: &TcpStream,
    token: &str,
    limits: Limits,
    dispatch: &mut D,
) -> std::io::Result<()> {
    // The listener is blocking, so this normally already holds — say it explicitly so a
    // future change to the listener's mode cannot turn `read` into `WouldBlock`.
    stream.set_nonblocking(false)?;
    stream.set_nodelay(true)?;
    // A peer that connects and says nothing (or dribbles bytes) must not hold the slot.
    stream.set_read_timeout(Some(limits.handshake))?;
    let reader_stream = stream.try_clone()?;
    let mut reader = BufReader::new(reader_stream);
    let mut writer = stream.try_clone()?;

    // Handshake: the first line is the token the bridge read from `mcp.json`.
    let Some(hello) = read_line_bounded(&mut reader, limits.max_handshake)? else {
        return Ok(());
    };
    if hello.trim() != token {
        log::warn!("MCP connection rejected: bad token (stale mcp.json?)");
        return Ok(());
    }

    stream.set_read_timeout(Some(limits.idle))?;
    // Ends when the bridge/agent closes the session (no line left to read).
    while let Some(line) = read_line_bounded(&mut reader, limits.max_message)? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(response) = protocol::handle_message(trimmed, dispatch) {
            let mut bytes = serde_json::to_vec(&response)?;
            bytes.push(b'\n');
            writer.write_all(&bytes)?;
            writer.flush()?;
        }
    }
    Ok(())
}

/// Read one `\n`-terminated line, refusing to buffer more than `max` bytes.
///
/// Returns `None` at end of stream. A line longer than `max` is an `InvalidData` error:
/// the session ends instead of the server growing a buffer for a peer that never sends
/// a newline.
fn read_line_bounded<R: BufRead>(reader: &mut R, max: usize) -> std::io::Result<Option<String>> {
    let mut line: Vec<u8> = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(if line.is_empty() {
                None
            } else {
                Some(String::from_utf8_lossy(&line).into_owned())
            });
        }
        let newline = available.iter().position(|&byte| byte == b'\n');
        let take = newline.unwrap_or(available.len());
        line.extend_from_slice(&available[..take]);
        reader.consume(take + usize::from(newline.is_some()));
        if line.len() > max {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("MCP message exceeds {max} bytes"),
            ));
        }
        if newline.is_some() {
            return Ok(Some(String::from_utf8_lossy(&line).into_owned()));
        }
    }
}

/// Serve one session with the production limits, completing each request through
/// `dispatch`.
pub(super) fn serve<D: FnMut(&str, Value) -> Result<Value, String>>(
    stream: &TcpStream,
    token: &str,
    dispatch: &mut D,
) -> std::io::Result<()> {
    serve_session(stream, token, Limits::default(), dispatch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::BufReader;
    use std::net::{TcpListener, TcpStream};

    const TOKEN: &str = "test-token";

    fn pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("address");
        let client = TcpStream::connect(address).expect("connect");
        let (server, _) = listener.accept().expect("accept");
        (server, client)
    }

    fn limits() -> Limits {
        Limits {
            handshake: Duration::from_millis(200),
            idle: Duration::from_secs(5),
            max_handshake: 32,
            max_message: 128,
        }
    }

    fn noop(tool: &str, _args: Value) -> Result<Value, String> {
        Ok(json!({ "tool": tool }))
    }

    /// Serve `server` on a thread with the test limits, so a test can drive the client
    /// side without deadlocking.
    fn serve_in_background(server: TcpStream) -> std::thread::JoinHandle<std::io::Result<()>> {
        std::thread::spawn(move || {
            let mut dispatch = noop;
            serve_session(&server, TOKEN, limits(), &mut dispatch)
        })
    }

    /// A second handle on the client socket, ready to write a line.
    fn client_writer(client: &TcpStream) -> TcpStream {
        client.try_clone().expect("clone")
    }

    #[test]
    fn serves_a_request_after_the_handshake() {
        let (server, client) = pair();
        let handle = serve_in_background(server);
        let mut writer = client_writer(&client);
        writer.write_all(format!("{TOKEN}\n").as_bytes()).unwrap();
        writer
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n")
            .unwrap();
        let mut reader = BufReader::new(client);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.contains("\"result\""), "response: {line}");
        drop(writer);
        drop(reader);
        assert!(handle.join().expect("join").is_ok());
    }

    #[test]
    fn a_stalled_client_is_dropped_at_the_handshake_deadline() {
        let (server, client) = pair();
        let started = std::time::Instant::now();
        let mut dispatch = noop;
        let result = serve_session(&server, TOKEN, limits(), &mut dispatch);
        assert!(result.is_err(), "a silent peer must not be served");
        assert!(started.elapsed() < Duration::from_secs(2));
        drop(client);
    }

    #[test]
    fn an_oversized_handshake_is_rejected() {
        let (server, client) = pair();
        let handle = serve_in_background(server);
        let mut writer = client_writer(&client);
        // No newline until well past the cap: the server must not buffer it.
        writer.write_all(&vec![b'x'; 1024]).unwrap();
        writer.write_all(b"\n").unwrap();
        assert!(handle.join().expect("join").is_err());
    }

    #[test]
    fn an_oversized_message_is_rejected() {
        let (server, client) = pair();
        let handle = serve_in_background(server);
        let mut writer = client_writer(&client);
        writer.write_all(format!("{TOKEN}\n").as_bytes()).unwrap();
        writer.write_all(&vec![b'x'; 1024]).unwrap();
        assert!(handle.join().expect("join").is_err());
    }

    #[test]
    fn a_bad_token_is_rejected_without_reading_messages() {
        let (server, client) = pair();
        let handle = serve_in_background(server);
        let mut writer = client_writer(&client);
        writer.write_all(b"not-the-token\n").unwrap();
        drop(writer);
        assert!(handle.join().expect("join").is_ok());
    }

    #[test]
    fn the_session_cap_is_released_when_a_session_ends() {
        let sessions = Sessions::new();
        let mut permits = Vec::new();
        for _ in 0..MAX_SESSIONS {
            permits.push(sessions.try_enter().expect("a slot is free"));
        }
        assert!(sessions.try_enter().is_none(), "the cap is enforced");
        permits.pop();
        assert!(
            sessions.try_enter().is_some(),
            "a finished session frees its slot"
        );
    }
}
