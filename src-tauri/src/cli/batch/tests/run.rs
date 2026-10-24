//! Running a resolved request through the headless session (no Tauri app, no display).

use super::*;
use crate::mcp::dispatch::HeadlessSession;
use serde_json::Value;

use super::super::analyzers::run_analyzers;

#[test]
fn run_applies_a_filter_before_analysis() {
    let path = std::env::temp_dir().join("hey_listen_cli_filter.wav");
    write_sine_wav(&path, 8_000, 8_000);
    let mut request = analyze_request(
        vec![path.to_string_lossy().into_owned()],
        vec!["levels".into()],
    );
    request.filter = Some(gain_filter(0.5));

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    // The 0.5-amplitude sine is halved by the 0.5 gain filter.
    let peak = values[0]["result"]["peak"].as_f64().unwrap();
    assert!((0.20..0.30).contains(&peak), "filtered peak: {peak}");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_finds_the_spectrum_peak() {
    let path = std::env::temp_dir().join("hey_listen_cli_peak.wav");
    write_sine_wav(&path, 8_000, 8_000);
    let file = path.to_string_lossy().into_owned();
    let request = analyze_request(vec![file.clone()], vec!["spectrum".into()]);

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);

    let values = lines(&out);
    assert_eq!(values.len(), 1);
    assert_eq!(values[0]["file"], file);
    // The `tool` tag lives in the result, not duplicated on the envelope.
    assert_eq!(values[0]["result"]["tool"], "spectrum");
    let peak = values[0]["result"]["peakHz"].as_f64().unwrap();
    assert!(
        (380.0..500.0).contains(&peak),
        "peak Hz out of range: {peak}"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_frame_rms_applies_its_option_patch() {
    let path = std::env::temp_dir().join("hey_listen_cli_frame_rms.wav");
    write_sine_wav(&path, 8_000, 8_000);
    let mut request = analyze_request(
        vec![path.to_string_lossy().into_owned()],
        vec!["frameRms".into()],
    );
    // `-o frameRms.frameMs=20 -o frameRms.hopMs=10` at 8 kHz → 160 / 80 samples.
    request.options = vec![
        OptionPatch {
            tool: "frameRms".into(),
            key: "frameMs".into(),
            value: json!(20),
        },
        OptionPatch {
            tool: "frameRms".into(),
            key: "hopMs".into(),
            value: json!(10),
        },
    ];

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values.len(), 1);
    assert_eq!(values[0]["result"]["tool"], "frameRms");
    assert_eq!(values[0]["result"]["frameSize"], 160);
    assert_eq!(values[0]["result"]["hopSize"], 80);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_prints_one_line_per_file() {
    let a = std::env::temp_dir().join("hey_listen_cli_a.wav");
    let b = std::env::temp_dir().join("hey_listen_cli_b.wav");
    write_sine_wav(&a, 8_000, 4_000);
    write_sine_wav(&b, 8_000, 4_000);
    let request = analyze_request(
        vec![
            a.to_string_lossy().into_owned(),
            b.to_string_lossy().into_owned(),
        ],
        vec!["levels".into()],
    );

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    assert_eq!(lines(&out).len(), 2);
    let _ = std::fs::remove_file(&a);
    let _ = std::fs::remove_file(&b);
}

#[test]
fn run_reports_an_unknown_tool_as_an_error_line() {
    let path = std::env::temp_dir().join("hey_listen_cli_unknown.wav");
    write_sine_wav(&path, 8_000, 4_000);
    let request = analyze_request(
        vec![path.to_string_lossy().into_owned()],
        vec!["nope".into()],
    );

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    let values = lines(&out);
    assert_eq!(values[0]["tool"], "nope");
    assert!(values[0]["error"]
        .as_str()
        .unwrap()
        .contains("unknown analyzer"));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_reports_a_missing_file() {
    let request = analyze_request(vec!["/no/such/file.wav".into()], vec!["levels".into()]);
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    let values = lines(&out);
    assert_eq!(values[0]["file"], "/no/such/file.wav");
    assert!(values[0]["error"].is_string());
    assert!(values[0].get("tool").is_none());
}

#[test]
fn run_lists_the_catalog_as_json_or_a_table() {
    let mut session = HeadlessSession::default();

    let mut json_out = Vec::new();
    assert_eq!(run_analyzers(&mut session, true, &mut json_out), 0);
    let catalog: Vec<Value> = serde_json::from_slice(&json_out).unwrap();
    assert!(catalog.iter().any(|item| item["id"] == "spectrum"));

    let mut table_out = Vec::new();
    assert_eq!(run_analyzers(&mut session, false, &mut table_out), 0);
    let table = String::from_utf8(table_out).unwrap();
    assert!(table.contains("spectrum\tspectral\tSpectrum"));
}

#[test]
fn run_renders_a_synth() {
    let path = write_synth_graph("hey_listen_cli_synth_run.json");
    let request = Request {
        command: Command::Synth {
            graph: sine_graph(),
            seconds: 0.5,
            path: path.clone(),
        },
        files: Vec::new(),
        tools: vec!["levels".into()],
        all: false,
        start: None,
        end: None,
        params: Vec::new(),
        options: Vec::new(),
        filter: None,
        full: false,
        pretty: false,
        fail_fast: false,
    };

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values.len(), 1);
    assert_eq!(values[0]["file"], path);
    assert_eq!(values[0]["result"]["tool"], "levels");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_reports_a_synth_source_when_no_tool_is_given() {
    let path = write_synth_graph("hey_listen_cli_synth_summary.json");
    let request = Request {
        command: Command::Synth {
            graph: sine_graph(),
            seconds: 0.25,
            path: path.clone(),
        },
        files: Vec::new(),
        tools: Vec::new(),
        all: false,
        start: None,
        end: None,
        params: Vec::new(),
        options: Vec::new(),
        filter: None,
        full: false,
        pretty: false,
        fail_fast: false,
    };

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values.len(), 1);
    assert_eq!(values[0]["file"], path);
    assert_eq!(values[0]["source"]["sampleRate"], 48_000);
    let _ = std::fs::remove_file(&path);
}
