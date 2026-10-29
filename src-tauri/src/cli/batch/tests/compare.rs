//! `compare` subcommand tests: two project files, one tool, one JSONL line.

use super::*;
use crate::project::{write_project, AnalysisSetup, AnalysisWindow, SaveProject, SourceDescriptor};
use crate::state::SourcePcm;

/// Write a `.heyl` project whose source is a mono 8 kHz sine at `amplitude`.
fn write_project_file(name: &str, amplitude: f32, window: (f64, f64)) -> String {
    let rate = 8_000u32;
    let samples: Vec<f32> = (0..rate as usize)
        .map(|frame| {
            let t = frame as f32 / rate as f32;
            amplitude * (t * 440.0 * std::f32::consts::TAU).sin()
        })
        .collect();
    let pcm = SourcePcm {
        samples,
        sample_rate: rate,
        channels: 1,
    };
    let path = std::env::temp_dir().join(name);
    let span = AnalysisWindow {
        start_secs: window.0,
        end_secs: window.1,
    };
    let save = SaveProject {
        name: name.to_string(),
        created_ms: None,
        source: Some(SourceDescriptor {
            kind: "file".to_string(),
            path: Some("sine.wav".to_string()),
            ..Default::default()
        }),
        setup: AnalysisSetup {
            window: span,
            view: span,
            ..Default::default()
        },
        layout: serde_json::json!({ "dockview": null, "graphs": {} }),
        results: Vec::new(),
        notes: Vec::new(),
        pcm: Some(&pcm),
    };
    let mut file = std::fs::File::create(&path).unwrap();
    write_project(&mut file, &save, 1).unwrap();
    path.to_string_lossy().into_owned()
}

fn compare_request(a: String, b: String, tools: Vec<String>) -> Request {
    let mut request = analyze_request(Vec::new(), tools);
    request.command = Command::Compare { a, b };
    request
}

#[test]
fn compare_reports_a_level_delta_between_two_projects() {
    let a = write_project_file("hey_compare_a.heyl", 1.0, (0.0, 0.5));
    let b = write_project_file("hey_compare_b.heyl", 0.5, (0.0, 0.5));
    let request = compare_request(a.clone(), b.clone(), vec!["levels".to_string()]);

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values.len(), 1);
    let value = &values[0];
    assert_eq!(value["tool"], "levels");
    assert_eq!(value["a"]["file"], a);
    assert_eq!(value["b"]["file"], b);
    assert_eq!(value["comparability"]["aligned"], true);
    assert_eq!(value["diff"]["kind"], "scalar");
    let rms = value["diff"]["fields"]
        .as_array()
        .unwrap()
        .iter()
        .find(|field| field["key"] == "rmsDb")
        .expect("rmsDb field");
    let delta = rms["delta"].as_f64().unwrap();
    assert!((delta + 6.02).abs() < 0.6, "rmsDb delta: {delta}");
    let _ = std::fs::remove_file(&a);
    let _ = std::fs::remove_file(&b);
}

#[test]
fn compare_reports_the_overlap_and_can_clip_to_it() {
    let a = write_project_file("hey_compare_overlap_a.heyl", 1.0, (0.0, 0.5));
    let b = write_project_file("hey_compare_overlap_b.heyl", 1.0, (0.25, 0.75));

    let mut request = compare_request(a.clone(), b.clone(), vec!["levels".to_string()]);
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    let overlap = &values[0]["comparability"]["overlap"];
    assert_eq!(overlap["start"].as_f64(), Some(0.25));
    assert_eq!(overlap["end"].as_f64(), Some(0.5));
    // The sides keep their own windows without `--overlap`.
    assert_eq!(values[0]["a"]["window"]["start"].as_f64(), Some(0.0));
    assert_eq!(values[0]["b"]["window"]["start"].as_f64(), Some(0.25));

    request.overlap = true;
    let mut clipped = Vec::new();
    assert_eq!(run(&request, &mut clipped), 0);
    let values = lines(&clipped);
    assert_eq!(values[0]["a"]["window"]["start"].as_f64(), Some(0.25));
    assert_eq!(values[0]["a"]["window"]["end"].as_f64(), Some(0.5));
    assert_eq!(values[0]["b"]["window"]["end"].as_f64(), Some(0.5));

    let _ = std::fs::remove_file(&a);
    let _ = std::fs::remove_file(&b);
}

#[test]
fn compare_emits_one_line_per_tool_and_shape_follows_the_flags() {
    let a = write_project_file("hey_compare_tools_a.heyl", 1.0, (0.0, 0.25));
    let b = write_project_file("hey_compare_tools_b.heyl", 0.5, (0.0, 0.25));
    let mut request = compare_request(
        a.clone(),
        b.clone(),
        vec!["levels".to_string(), "spectrum".to_string()],
    );
    request.summary = true;

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values.len(), 2);
    for value in &values {
        assert!(
            value["a"].get("result").is_none(),
            "summary mode has no result"
        );
        assert!(value["diff"]["summary"]
            .as_str()
            .is_some_and(|s| !s.is_empty()));
    }
    assert_eq!(values[0]["tool"], "levels");
    assert_eq!(values[1]["tool"], "spectrum");
    let _ = std::fs::remove_file(&a);
    let _ = std::fs::remove_file(&b);
}

#[test]
fn compare_fails_cleanly_when_a_project_cannot_be_read() {
    let a = write_project_file("hey_compare_missing_a.heyl", 1.0, (0.0, 0.25));
    let request = compare_request(
        a.clone(),
        "/no/such/project.heyl".to_string(),
        vec!["levels".to_string()],
    );
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    assert!(
        out.is_empty(),
        "a load failure is reported on stderr, not JSONL"
    );
    let _ = std::fs::remove_file(&a);
}
