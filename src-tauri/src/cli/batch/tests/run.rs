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
fn run_summary_mode_omits_the_result() {
    let path = std::env::temp_dir().join("hey_listen_cli_summary.wav");
    write_sine_wav(&path, 8_000, 8_000);
    let mut request = analyze_request(
        vec![path.to_string_lossy().into_owned()],
        vec!["spectrum".into()],
    );
    request.summary = true;

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values.len(), 1);
    assert!(values[0].get("result").is_none());
    assert_eq!(values[0]["summary"]["tool"], "spectrum");
    assert!(values[0]["summary"]["text"]
        .as_str()
        .is_some_and(|text| text.contains("peak")));
    assert!(values[0]["summary"]["items"]
        .as_array()
        .is_some_and(|items| !items.is_empty()));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_defaults_to_a_compact_structurally_shaped_result() {
    let path = std::env::temp_dir().join("hey_listen_cli_compact.wav");
    write_sine_wav(&path, 8_000, 8_000);
    let request = analyze_request(
        vec![path.to_string_lossy().into_owned()],
        vec!["spectrogram".into()],
    );

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    let result = &values[0]["result"];
    // The compact spectrogram keeps its dimensions and peak location.
    assert!(result["frames"].as_u64().is_some_and(|frames| frames > 0));
    assert!(result["bins"].as_u64().is_some_and(|bins| bins > 0));
    assert!(result["peakHz"].as_f64().is_some_and(|hz| hz > 0.0));
    assert!(result["magDb"]["length"].as_u64().is_some_and(|n| n > 0));
    assert!(result["magDb"].get("min").is_some());
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
    assert_eq!(run_analyzers(&mut session, None, true, &mut json_out), 0);
    let catalog: Vec<Value> = serde_json::from_slice(&json_out).unwrap();
    assert!(catalog.iter().any(|item| item["id"] == "spectrum"));

    let mut table_out = Vec::new();
    assert_eq!(run_analyzers(&mut session, None, false, &mut table_out), 0);
    let table = String::from_utf8(table_out).unwrap();
    assert!(table.contains("spectrum\tspectral\tSpectrum"));
}

#[test]
fn run_explains_one_analyzer() {
    let mut session = HeadlessSession::default();

    let mut json_out = Vec::new();
    assert_eq!(
        run_analyzers(&mut session, Some("frameRms"), true, &mut json_out),
        0
    );
    let detail = lines(&json_out).remove(0);
    assert_eq!(detail["id"], "frameRms");
    assert!(detail["about"]
        .as_str()
        .is_some_and(|about| !about.is_empty()));
    assert_eq!(detail["options"][0]["key"], "frameMs");
    assert_eq!(detail["options"][0]["unit"], "ms");
    assert!(detail["summaryKeys"]
        .as_array()
        .is_some_and(|keys| keys.iter().any(|key| key == "maxDb")));

    let mut text_out = Vec::new();
    assert_eq!(
        run_analyzers(&mut session, Some("frameRms"), false, &mut text_out),
        0
    );
    let text = String::from_utf8(text_out).unwrap();
    assert!(text.contains("frameRms — Amplitude envelope (time)"));
    assert!(text.contains("frameMs"));
    assert!(text.contains("default 10 ms"));
    assert!(text.contains("Summary keys: minDb, maxDb"));

    // An unknown id is an error (exit 1), not a panic.
    let mut out = Vec::new();
    assert_eq!(
        run_analyzers(&mut session, Some("nope"), false, &mut out),
        1
    );
}

#[test]
fn run_renders_a_synth() {
    let path = write_synth_graph("hey_listen_cli_synth_run.json");
    let request = synth_request(&path, 0.5, vec!["levels".into()]);

    let value = run_single(&request);
    assert_eq!(value["file"], path);
    assert_eq!(value["result"]["tool"], "levels");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_reports_a_synth_source_when_no_tool_is_given() {
    let path = write_synth_graph("hey_listen_cli_synth_summary.json");
    let request = synth_request(&path, 0.25, Vec::new());

    let value = run_single(&request);
    assert_eq!(value["file"], path);
    assert_eq!(value["source"]["sampleRate"], 48_000);
    let _ = std::fs::remove_file(&path);
}
