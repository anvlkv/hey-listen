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
        assert_eq!(hello.trim(), HELLO);
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
    let socket = handshake(socket).expect("the app accepts the greeting");
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

/// Read the greeting line the bridge sends.
fn read_greeting(stream: &TcpStream) -> String {
    let mut line = String::new();
    BufReader::new(stream.try_clone().expect("clone"))
        .read_line(&mut line)
        .expect("handshake");
    line.trim().to_string()
}

fn temp_store(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(name);
    let _ = std::fs::remove_file(&path);
    path
}

fn write_advertisement(path: &Path, port: u16) {
    std::fs::write(
        path,
        format!(
            r#"{{"enabled":true,"port":0,"boundPort":{port},"pid":{},"binary":"{}"}}"#,
            std::process::id(),
            crate::mcp::advertise::current_binary().unwrap_or_default()
        ),
    )
    .expect("write");
}

/// A healthy app stays silent after the greeting, so silence is acceptance.
#[test]
fn a_silent_handshake_is_accepted() {
    let socket = pair(|stream| {
        assert_eq!(read_greeting(&stream), HELLO);
        // Hold the session open, as the app does.
        std::thread::sleep(HANDSHAKE_CHECK * 3);
    });
    let stream = handshake(socket).expect("an accepted handshake returns the socket");
    // The read deadline must be cleared for the pump's blocking reads.
    assert!(stream.read_timeout().expect("timeout query").is_none());
}

/// A restarted app can be serving on the previous ephemeral port while the store still
/// names the previous process: the server closes the socket, and the bridge must see that
/// as a refusal (so it re-reads the advertisement) instead of pumping into a dead session.
#[test]
fn a_refused_handshake_is_reported() {
    let socket = pair(|stream| {
        assert_eq!(read_greeting(&stream), HELLO);
        stream.shutdown(Shutdown::Both).expect("the app refuses");
    });
    assert!(handshake(socket).is_err());
}

/// The relaunch case: the first attempt meets the previous process (or another program
/// on the reused port) and is refused, the app then republishes with its own endpoint,
/// and the retry re-reads the store and attaches. Before the fix a fixed, tiny retry
/// count could exhaust itself before the rewritten advertisement landed.
#[test]
fn attach_re_reads_a_rewritten_advertisement() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("address").port();
    let second = TcpListener::bind("127.0.0.1:0").expect("bind");
    let second_port = second.local_addr().expect("address").port();
    let path = temp_store("hey_listen_retry_store.json");
    write_advertisement(&path, port);

    let server_path = path.clone();
    let app = std::thread::spawn(move || {
        // The first bridge connection reaches the previous process. Republish (as the new
        // app does in `setup`) before refusing it, so the retry reads the new endpoint.
        let (first, _) = listener.accept().expect("first accept");
        read_greeting(&first);
        write_advertisement(&server_path, second_port);
        first.shutdown(Shutdown::Both).expect("refuse");

        let (second, _) = second.accept().expect("second accept");
        assert_eq!(read_greeting(&second), HELLO);
        std::thread::sleep(HANDSHAKE_CHECK * 3);
    });

    let stream = attach_from(Instant::now() + Duration::from_secs(5), || {
        endpoint::read_advertisement_at(&path)
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
    let path = temp_store("hey_listen_dead_store.json");
    write_advertisement(&path, port);
    drop(listener);

    let started = Instant::now();
    let error = attach_from(Instant::now() + Duration::from_millis(300), || {
        endpoint::read_advertisement_at(&path)
    })
    .expect_err("a dead endpoint cannot be attached");
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "attach ignored its deadline"
    );
    assert!(error.to_string().contains("could not connect"), "{error}");

    let _ = std::fs::remove_file(&path);
}
