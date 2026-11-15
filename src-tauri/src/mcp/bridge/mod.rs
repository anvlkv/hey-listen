//! The stdio ⇄ localhost bridge (`heylisten-mcp`, or `hey-listen --mcp`).
//!
//! MCP clients launch a local server as a `command` + `args` and
//! speak MCP over its stdio. The actual server lives in the running Hey Listen
//! process (so agent calls drive the user's window), so this bridge is a dumb byte
//! pump: it reads the advertised endpoint (see [`endpoint`]), connects, sends the
//! token, and forwards bytes both ways.

mod endpoint;

use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::{Duration, Instant};

pub use endpoint::wait_for_live;

/// How long to wait for the app to advertise itself before giving up.
const DISCOVER_TIMEOUT: Duration = Duration::from_secs(15);

/// How long the bridge waits for the server to reject a handshake.
///
/// A successful handshake is silent (the server sends nothing until we forward a
/// request); a rejected one closes the socket immediately. This is the only way to tell
/// them apart, and it is worth the short wait: see [`handshake`].
const HANDSHAKE_CHECK: Duration = Duration::from_millis(250);

/// How many times a rejected handshake is retried from a freshly read advertisement.
const HANDSHAKE_ATTEMPTS: usize = 4;

/// How long to wait between handshake attempts (the app may still be rewriting `mcp.json`).
const HANDSHAKE_RETRY_PAUSE: Duration = Duration::from_millis(100);

/// How long to wait for the stdin forwarding thread after the socket closes. A normal MCP
/// client keeps stdin open, so that thread can stay blocked in `read` forever; the bridge
/// must not wait for it (audit P2 #9).
const STDIN_GRACE: Duration = Duration::from_millis(500);

/// Run the bridge until stdin or the socket closes.
pub fn run() -> std::io::Result<()> {
    let stream = connect_live()?;
    pump(stream, std::io::stdin(), std::io::stdout())
}

/// Connect to the running app and complete the token handshake.
///
/// The advertisement can be **stale for a moment** right after the app restarts: the
/// file still describes the previous process, and the kernel often hands the same
/// ephemeral port back, so the connection succeeds and then the token is rejected. That
/// used to end the bridge — and with it the client's whole session, whose first request
/// had not even been read from stdin yet. Retrying here is safe precisely because the
/// client's bytes are still buffered in stdin (nothing has been forwarded), and the
/// rejection itself is the signal to re-read the file.
fn connect_live() -> std::io::Result<TcpStream> {
    let mut attempt = 1;
    loop {
        let info = read_advertisement()?;
        let stream = connect(info.port)?;
        match handshake(stream, &info.token) {
            Ok(stream) => return Ok(stream),
            Err(err) if attempt >= HANDSHAKE_ATTEMPTS => return Err(err),
            Err(err) => log::warn!(
                "MCP handshake rejected ({err}); re-reading the advertisement and retrying"
            ),
        }
        attempt += 1;
        std::thread::sleep(HANDSHAKE_RETRY_PAUSE);
    }
}

/// Send the token and confirm the server kept the session.
///
/// The first line of the connection is the token (the server rejects a mismatch), after
/// which a healthy server stays silent until it has a response to write. So: peek for a
/// moment — end of stream means the handshake was refused, silence means it was accepted.
/// `peek` never consumes the byte, so a (not expected) early message is still forwarded.
fn handshake(mut stream: TcpStream, token: &str) -> std::io::Result<TcpStream> {
    stream.set_nodelay(true)?;
    stream.write_all(token.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()?;

    stream.set_read_timeout(Some(HANDSHAKE_CHECK))?;
    let mut probe = [0u8; 1];
    let outcome = match stream.peek(&mut probe) {
        Ok(0) => Err(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "the app refused the handshake (stale mcp.json?)",
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
    // client holds it (see `docs/mcp.md`).
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

/// Read the advertised endpoint, waiting briefly for the app to publish it (the
/// server may be added while the app is still starting).
fn read_advertisement() -> std::io::Result<endpoint::Info> {
    let deadline = Instant::now() + DISCOVER_TIMEOUT;
    loop {
        match endpoint::read_info() {
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
        let socket = handshake(socket, "token").expect("the app accepts the token");
        pump(socket, BlockedStdin, sink.clone()).expect("pump");
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "the bridge waited for the blocked stdin reader"
        );
        assert!(String::from_utf8_lossy(&sink.0.lock().expect("sink")).contains("result"));
        app.join().expect("app thread");
    }

    /// Serve one connection with `app`, returning the client end of the pair.
    fn pair(app: impl FnOnce(TcpStream) + Send + 'static) -> TcpStream {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("address");
        std::thread::spawn(move || app(listener.accept().expect("accept").0));
        TcpStream::connect(address).expect("connect")
    }

    /// Read the token line the bridge sends.
    fn read_token(stream: &TcpStream) -> String {
        let mut line = String::new();
        BufReader::new(stream.try_clone().expect("clone"))
            .read_line(&mut line)
            .expect("handshake");
        line.trim().to_string()
    }

    /// A healthy app stays silent after the token, so silence is acceptance.
    #[test]
    fn a_silent_handshake_is_accepted() {
        let socket = pair(|stream| {
            assert_eq!(read_token(&stream), "token");
            // Hold the session open, as the app does.
            std::thread::sleep(HANDSHAKE_CHECK * 3);
        });
        let stream = handshake(socket, "token").expect("an accepted handshake returns the socket");
        // The read deadline must be cleared for the pump's blocking reads.
        assert!(stream.read_timeout().expect("timeout query").is_none());
    }

    /// A restarted app can be serving on the previous ephemeral port while `mcp.json` still
    /// carries the old token: the server closes the socket, and the bridge must see that as
    /// a refusal (so it re-reads the advertisement) instead of pumping into a dead session.
    #[test]
    fn a_refused_handshake_is_reported() {
        let socket = pair(|stream| {
            assert_eq!(read_token(&stream), "token");
            stream.shutdown(Shutdown::Both).expect("the app refuses");
        });
        assert!(handshake(socket, "token").is_err());
    }
}
