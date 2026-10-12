//! Integration test for the headless MCP server (`heylisten-mcp --headless`).
//!
//! Spawns the real binary, speaks newline-delimited MCP over its stdio, and drives
//! the compute subset end to end: initialize → open an audio file → run an analyzer.
//! This is the "no app, just the CLI" path described in `docs/mcp.md`.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

/// Write a minimal 16-bit PCM mono WAV with a half-scale 440 Hz sine.
fn write_sine_wav(path: &Path, rate: u32, frames: usize) {
    let bits = 16u16;
    let block_align = bits / 8;
    let byte_rate = rate * u32::from(block_align);
    let data_len = frames as u32 * u32::from(block_align);

    let mut buf = Vec::new();
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_len).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
    buf.extend_from_slice(&1u16.to_le_bytes()); // mono
    buf.extend_from_slice(&rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits.to_le_bytes());
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());

    for f in 0..frames {
        let t = f as f32 / rate as f32;
        let sample = (t * 440.0 * std::f32::consts::TAU).sin() * 0.5;
        let value = (sample * f32::from(i16::MAX)) as i16;
        buf.extend_from_slice(&value.to_le_bytes());
    }

    std::fs::write(path, buf).unwrap();
}

/// A minimal stdio MCP client over a child process.
struct Client {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Client {
    fn spawn() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_heylisten-mcp"))
            .arg("--headless")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn heylisten-mcp");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            stdin,
            stdout,
        }
    }

    fn request(&mut self, id: u32, method: &str, params: serde_json::Value) -> serde_json::Value {
        let message =
            serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        writeln!(self.stdin, "{message}").unwrap();
        self.stdin.flush().unwrap();
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        serde_json::from_str(&line).expect("a JSON-RPC response line")
    }

    fn call(&mut self, id: u32, tool: &str, args: serde_json::Value) -> serde_json::Value {
        let response = self.request(
            id,
            "tools/call",
            serde_json::json!({ "name": tool, "arguments": args }),
        );
        assert!(
            response.get("error").is_none(),
            "tools/call error: {response}"
        );
        response["result"].clone()
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn headless_server_drives_the_analysis_engine() {
    let wav = std::env::temp_dir().join("hey_listen_mcp_headless.wav");
    write_sine_wav(&wav, 8_000, 8_000); // 1 second at 8 kHz

    let mut client = Client::spawn();

    // initialize
    let init = client.request(
        1,
        "initialize",
        serde_json::json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "test", "version": "1" } }),
    );
    assert_eq!(init["result"]["serverInfo"]["name"], "hey-listen");

    // tools/list advertises the compute subset.
    let list = client.request(2, "tools/list", serde_json::json!({}));
    let tools: Vec<&str> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    for expected in [
        "run_analysis",
        "open_audio_file",
        "list_analyzers",
        "render_synth",
        "list_projects",
    ] {
        assert!(tools.contains(&expected), "missing tool {expected}");
    }

    // list_analyzers returns the catalog.
    let analyzers = client.call(3, "list_analyzers", serde_json::json!({}));
    assert!(analyzers["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("spectrum"));

    // open_audio_file decodes the WAV into the headless session.
    let opened = client.call(
        4,
        "open_audio_file",
        serde_json::json!({ "path": wav.to_str().unwrap() }),
    );
    assert_eq!(opened["isError"], false, "open_audio_file failed: {opened}");
    assert_eq!(opened["structuredContent"]["channels"], 1);
    assert_eq!(opened["structuredContent"]["sampleRate"], 8_000);

    // run_analysis finds the 440 Hz tone.
    let analysis = client.call(
        5,
        "run_analysis",
        serde_json::json!({ "tool": "spectrum", "start": 0.1, "end": 0.9 }),
    );
    assert_eq!(
        analysis["isError"], false,
        "run_analysis failed: {analysis}"
    );
    let peak = analysis["structuredContent"]["result"]["peakHz"]
        .as_f64()
        .unwrap();
    assert!(
        (380.0..500.0).contains(&peak),
        "peak Hz out of range: {peak}"
    );

    // A UI-only tool explains that it needs the app.
    let ui_only = client.call(6, "open_tool", serde_json::json!({ "tool": "spectrum" }));
    assert_eq!(ui_only["isError"], true);
    assert!(ui_only["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("requires the app"));

    let _ = std::fs::remove_file(&wav);
}
