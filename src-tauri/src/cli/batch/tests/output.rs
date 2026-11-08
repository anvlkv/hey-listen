//! Output and error-contract tests (audit P2 #12, P3): a failed write, an unwritable
//! sidecar, an unknown `-t` id, and `synth --pretty` without a tool.

use super::*;
use serde_json::json;

#[test]
fn a_failing_writer_makes_the_run_fail() {
    let path = std::env::temp_dir().join("hey_listen_cli_write_fail.wav");
    write_sine_wav(&path, 8_000, 4_000);
    let request = analyze_request(
        vec![path.to_string_lossy().into_owned()],
        vec!["levels".into()],
    );
    // The result line cannot be written, so the run must not report success (audit P2 #12).
    assert_eq!(run(&request, &mut crate::test_support::FailingWriter), 1);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn an_unwritable_sidecar_fails_the_export() {
    let path = std::env::temp_dir().join("hey_listen_cli_sidecar_fail.wav");
    write_sine_wav(&path, 8_000, 4_000);
    let dir = std::env::temp_dir().join("hey_listen_cli_sidecar_fail_dir");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    // The sidecar path is a directory, so writing the provenance cannot succeed.
    std::fs::create_dir_all(dir.join("export.meta.json")).unwrap();

    let mut request = analyze_request(
        vec![path.to_string_lossy().into_owned()],
        vec!["levels".into()],
    );
    request.format = ExportFormat::Csv;
    request.out = Some(OutputTarget::File(
        dir.join("export.csv").to_string_lossy().into_owned(),
    ));

    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    let values = lines(&out);
    assert!(
        values[0]["error"]
            .as_str()
            .is_some_and(|error| error.contains("meta.json")),
        "{:?}",
        values[0]
    );
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_mis_applied_option_is_a_usage_error() {
    let path = std::env::temp_dir().join("hey_listen_cli_bad_option.wav");
    write_sine_wav(&path, 8_000, 4_000);
    let mut request = analyze_request(
        vec![path.to_string_lossy().into_owned()],
        vec!["frameRms".into()],
    );
    // `nMels` belongs to the spectral tools, not frameRms (audit P2 #10).
    request.options = vec![OptionPatch {
        tool: crate::audio::analyzers::AnalyzerId::FrameRms,
        key: "nMels".into(),
        value: json!(20),
    }];
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 2);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_reports_an_unknown_tool_as_an_error_line() {
    let path = std::env::temp_dir().join("hey_listen_cli_unknown_tool.wav");
    write_sine_wav(&path, 8_000, 2_000);
    let mut request = analyze_request(
        vec![path.to_string_lossy().into_owned()],
        vec!["levels".into()],
    );
    request.unknown_tools = vec!["nope".into()];

    let mut out = Vec::new();
    // The known tool still runs; the unknown id is one `error` record and exit 1.
    assert_eq!(run(&request, &mut out), 1);
    let values = lines(&out);
    assert_eq!(values.len(), 2);
    assert!(values.iter().any(|value| value["tool"] == "nope"
        && value["error"]
            .as_str()
            .is_some_and(|error| error.contains("unknown analyzer"))));
    assert!(values
        .iter()
        .any(|value| value["result"]["tool"] == "levels"));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_with_only_an_unknown_tool_does_not_decode() {
    // No known tool remains, so the run reports the error and never opens the file.
    let mut request = analyze_request(vec!["/no/such/file.wav".into()], Vec::new());
    request.unknown_tools = vec!["nope".into()];
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    let values = lines(&out);
    assert_eq!(values.len(), 1);
    assert_eq!(values[0]["tool"], "nope");
}

#[test]
fn run_pretty_prints_a_synth_source_summary() {
    let path = write_synth_graph("hey_listen_cli_synth_pretty.json");
    let m = matches(&[("graph", json!(path)), ("pretty", json!(true))]);
    let request = build_request("synth", &m).expect("synth without tools may be pretty");
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let text = String::from_utf8(out).unwrap();
    // Pretty-printed (indented) rather than one JSONL line.
    assert!(text.contains("{\n  \"file\""), "{text}");
    let _ = std::fs::remove_file(&path);
}
