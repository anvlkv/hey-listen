//! Pipeline tests for [`super`]: slicing, channel shaping, filtering, every format and
//! depth, and the rejected inputs. Each written file is decoded back with `oxiaudio` to
//! assert the bytes really carry the expected audio.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use oxiaudio::AudioBuffer;

use super::*;

const RATE: u32 = 8_000;
static COUNTER: AtomicUsize = AtomicUsize::new(0);

fn temp_path(ext: &str) -> PathBuf {
    let name = format!(
        "hey_listen_export_{}_{}.{ext}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    std::env::temp_dir().join(name)
}

fn source(samples: Vec<f32>, channels: u16) -> SourceData {
    SourceData {
        samples,
        sample_rate: RATE,
        channels,
    }
}

/// `seconds` of a constant stereo signal (`left`, `right`).
fn stereo(left: f32, right: f32, seconds: f32) -> SourceData {
    let frames = (seconds * RATE as f32) as usize;
    let mut samples = Vec::with_capacity(frames * 2);
    for _ in 0..frames {
        samples.push(left);
        samples.push(right);
    }
    source(samples, 2)
}

fn request(path: &Path) -> AudioExportRequest {
    AudioExportRequest {
        path: path.to_string_lossy().into_owned(),
        start: 0.0,
        end: 10.0,
        format: AudioExportFormat::Wav,
        depth: AudioExportDepth::F32,
        channels: AudioExportChannels::All,
        channel: None,
        apply_filter: false,
        filter: None,
    }
}

fn decode(path: &Path) -> AudioBuffer<f32> {
    let buffer = oxiaudio::decode_file(path).expect("the export must decode");
    let _ = std::fs::remove_file(path);
    buffer
}

/// A mono graph that scales the input by `gain`.
fn gain_graph(gain: f32) -> GraphSpec {
    use crate::audio::graph::{GraphEdge, GraphNode};
    GraphSpec {
        nodes: vec![
            GraphNode {
                id: "in".into(),
                kind: "input".into(),
                params: Vec::new(),
                subgraph: None,
            },
            GraphNode {
                id: "gain".into(),
                kind: "gain".into(),
                params: vec![gain],
                subgraph: None,
            },
            GraphNode {
                id: "out".into(),
                kind: "output".into(),
                params: vec![0.0],
                subgraph: None,
            },
        ],
        edges: vec![
            GraphEdge {
                from: "in".into(),
                from_port: 0,
                to: "gain".into(),
                to_port: 0,
            },
            GraphEdge {
                from: "gain".into(),
                from_port: 0,
                to: "out".into(),
                to_port: 0,
            },
        ],
    }
}

#[test]
fn slices_the_window_and_clamps_edges() {
    let path = temp_path("wav");
    let source = source(vec![0.25; RATE as usize], 1);
    let mut req = request(&path);
    // Negative start clamps to 0; the end past the source clamps to its end.
    req.start = -1.0;
    req.end = 0.5;
    let exported = export_source(Some(&source), &req).expect("export");
    assert_eq!(exported.frames, (RATE / 2) as u64);

    let decoded = decode(&path);
    assert_eq!(decoded.sample_rate, RATE);
    assert_eq!(decoded.channels.channel_count(), 1);
    assert_eq!(decoded.frame_count(), (RATE / 2) as usize);
}

#[test]
fn all_keeps_the_source_channels() {
    let path = temp_path("wav");
    let exported = export_source(Some(&stereo(1.0, 0.5, 0.1)), &request(&path)).expect("export");
    assert_eq!(exported.channels, 2);
    let decoded = decode(&path);
    assert_eq!(decoded.channels.channel_count(), 2);
    assert!((decoded.samples[0] - 1.0).abs() < 1e-6);
    assert!((decoded.samples[1] - 0.5).abs() < 1e-6);
}

#[test]
fn mono_downmixes_and_single_picks_a_source_channel() {
    let source = stereo(1.0, 0.5, 0.1);

    let mono_path = temp_path("wav");
    let mut req = request(&mono_path);
    req.channels = AudioExportChannels::Mono;
    export_source(Some(&source), &req).expect("mono export");
    let decoded = decode(&mono_path);
    assert_eq!(decoded.channels.channel_count(), 1);
    assert!((decoded.samples[0] - 0.75).abs() < 1e-6);

    let single_path = temp_path("wav");
    let mut req = request(&single_path);
    req.channels = AudioExportChannels::Single;
    req.channel = Some(1);
    export_source(Some(&source), &req).expect("single export");
    let decoded = decode(&single_path);
    assert_eq!(decoded.channels.channel_count(), 1);
    assert!((decoded.samples[0] - 0.5).abs() < 1e-6);
}

#[test]
fn the_filter_is_applied_only_when_asked() {
    let source = source(vec![1.0; 800], 1);

    let raw_path = temp_path("wav");
    let mut req = request(&raw_path);
    req.filter = Some(gain_graph(0.5));
    req.apply_filter = false;
    export_source(Some(&source), &req).expect("raw export");
    let decoded = decode(&raw_path);
    assert!((decoded.samples[0] - 1.0).abs() < 1e-3);

    let filtered_path = temp_path("wav");
    let mut req = request(&filtered_path);
    req.filter = Some(gain_graph(0.5));
    req.apply_filter = true;
    export_source(Some(&source), &req).expect("filtered export");
    let decoded = decode(&filtered_path);
    assert!((decoded.samples[0] - 0.5).abs() < 1e-3);
}

#[test]
fn every_format_and_allowed_depth_decodes_back() {
    let source = stereo(0.5, -0.25, 0.05);
    let formats = [
        AudioExportFormat::Wav,
        AudioExportFormat::Flac,
        AudioExportFormat::Aiff,
    ];
    let depths = [
        AudioExportDepth::F32,
        AudioExportDepth::I16,
        AudioExportDepth::I24,
        AudioExportDepth::I32,
    ];
    for format in formats {
        for depth in depths {
            if !depth.supported_by(format) {
                continue;
            }
            let (ext, _) = format.extension();
            let path = temp_path(ext);
            let mut req = request(&path);
            req.format = format;
            req.depth = depth;
            let exported = export_source(Some(&source), &req)
                .unwrap_or_else(|err| panic!("{format:?} at {depth:?} failed: {err}"));
            assert_eq!(exported.sample_rate, RATE);

            let decoded = decode(&path);
            assert_eq!(decoded.sample_rate, RATE);
            assert_eq!(decoded.channels.channel_count(), 2);
            assert_eq!(decoded.frame_count(), exported.frames as usize);
            assert!((decoded.samples[0] - 0.5).abs() < 1e-2);
        }
    }
}

#[test]
fn an_unnamable_channel_count_is_rejected() {
    let path = temp_path("wav");
    let three = source(vec![0.1; 300], 3);
    let err = export_source(Some(&three), &request(&path)).expect_err("3 channels are rejected");
    assert!(matches!(err, ExportError::UnsupportedChannels { count: 3 }));
}

#[test]
fn integer_clipping_is_reported() {
    let path = temp_path("wav");
    let loud = source(vec![1.5; 800], 1);
    let mut req = request(&path);
    req.depth = AudioExportDepth::I16;
    let exported = export_source(Some(&loud), &req).expect("export");
    assert!(exported.clipping);
    assert!((exported.peak - 1.5).abs() < 1e-6);
    decode(&path);
}

#[test]
fn float_export_does_not_clip() {
    let path = temp_path("wav");
    let loud = source(vec![1.5; 800], 1);
    let exported = export_source(Some(&loud), &request(&path)).expect("export");
    assert!(!exported.clipping);
    decode(&path);
}

#[test]
fn empty_window_and_missing_source_are_rejected() {
    let path = temp_path("wav");
    let mut req = request(&path);
    req.start = 0.2;
    req.end = 0.2;
    assert!(matches!(
        export_source(Some(&stereo(0.1, 0.1, 0.1)), &req),
        Err(ExportError::EmptyWindow)
    ));
    assert!(matches!(
        export_source(None, &request(&temp_path("wav"))),
        Err(ExportError::NoSource)
    ));
}
