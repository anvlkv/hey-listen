//! Diagnostic: capture a few seconds from the default microphone and from
//! system loopback and report whether non-silent audio arrives.
//!
//! Run with: `cargo run --example capture_probe`
//!
//! A `peak` of `0.0000` means the OS is feeding silence (usually a missing
//! macOS capture permission), while a non-zero peak means capture works and any
//! flat waveform is a frontend problem.

use std::time::{Duration, Instant};

use flexaudio::{open, OutputFormat, SourceKind, StreamConfig};

fn probe(kind: SourceKind, seconds: u64) {
    let config = StreamConfig {
        kind,
        output: OutputFormat {
            sample_rate: 48_000,
            channels: 2,
        },
        ..Default::default()
    };

    let mut stream = match open(config) {
        Ok(stream) => stream,
        Err(err) => {
            println!("{kind:?}: open failed: {err}");
            return;
        }
    };
    if let Err(err) = stream.start() {
        println!("{kind:?}: start failed: {err}");
        return;
    }

    let (rate, channels) = stream.native_format();
    println!("{kind:?}: native {rate} Hz / {channels} ch, capturing {seconds}s…");

    let deadline = Instant::now() + Duration::from_secs(seconds);
    let mut chunks = 0u64;
    let mut samples = 0u64;
    let mut peak = 0f32;

    while Instant::now() < deadline {
        while let Some(chunk) = stream.poll_chunk() {
            chunks += 1;
            samples += chunk.data.len() as u64;
            peak = peak.max(chunk.peak);
        }
        while let Some(event) = stream.poll_event() {
            println!("  {kind:?} event: {event:?}");
        }
        std::thread::sleep(Duration::from_millis(5));
    }

    stream.stop();
    println!("{kind:?}: chunks={chunks} samples={samples} peak={peak:.4}");
}

fn main() {
    probe(SourceKind::Mic, 3);
    probe(SourceKind::SystemLoopback, 3);
}
