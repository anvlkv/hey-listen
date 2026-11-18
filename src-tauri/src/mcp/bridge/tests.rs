//! Bridge tests (split from `mod.rs` for the source-size budget).

use super::*;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
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

fn temp_info(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(name);
    let _ = std::fs::remove_file(&path);
    path
}

fn write_info(path: &Path, port: u16, token: &str) {
    std::fs::write(path, format!("{{\"port\":{port},\"token\":\"{token}\"}}")).expect("write");
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

/// The relaunch case: the first attempt meets the previous process's token and is
/// refused, the app then republishes with its own token, and the retry re-reads the file
/// and attaches. Before the fix a fixed, tiny retry count could exhaust itself before
/// the rewritten advertisement landed.
#[test]
fn attach_re_reads_a_rewritten_advertisement() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("address").port();
    let path = temp_info("hey_listen_retry_mcp.json");
    write_info(&path, port, "old");

    let server_path = path.clone();
    let app = std::thread::spawn(move || {
        // The first bridge connection carries the previous process's token. Republish
        // (as the new app does in `setup`) before refusing it, so the retry reads it.
        let (first, _) = listener.accept().expect("first accept");
        assert_eq!(read_token(&first), "old");
        write_info(&server_path, port, "new");
        first.shutdown(Shutdown::Both).expect("refuse");

        let (second, _) = listener.accept().expect("second accept");
        assert_eq!(read_token(&second), "new");
        std::thread::sleep(HANDSHAKE_CHECK * 3);
    });

    let stream = attach_from(Instant::now() + Duration::from_secs(5), || {
        endpoint::read_info_at(&path)
    })
    .expect("the retry attaches once the advertisement is rewritten");
    assert!(stream.read_timeout().expect("timeout query").is_none());

    app.join().expect("app thread");
    let _ = std::fs::remove_file(&path);
}

/// Discovery only attaches once the endpoint answered, but the app can still die (or be
/// re-launched on another port) in between: attach must give up at its deadline rather
/// than retrying forever, so the caller can fall back to headless.
#[test]
fn attach_gives_up_at_its_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("address").port();
    let path = temp_info("hey_listen_dead_mcp.json");
    write_info(&path, port, "token");
    drop(listener);

    let started = Instant::now();
    let error = attach_from(Instant::now() + Duration::from_millis(300), || {
        endpoint::read_info_at(&path)
    })
    .expect_err("a dead endpoint cannot be attached");
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "attach ignored its deadline"
    );
    assert!(error.to_string().contains("could not connect"), "{error}");

    let _ = std::fs::remove_file(&path);
}
