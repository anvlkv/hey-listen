//! `notes` — reading a saved project's notes.

use super::*;
use serde_json::{json, Value};

/// Write a `.heyl` with two notes (a chart note with values, a timeline range note).
fn write_project_file(name: &str) -> String {
    use crate::project::sections::{AnalysisWindow, NoteValues};
    use crate::project::{write_project, Note, SaveProject};
    let path = std::env::temp_dir().join(name);
    let chart_note = Note {
        id: "n1".into(),
        created_ms: 1,
        updated_ms: 2,
        time_secs: 2.5,
        range: None,
        tool: Some("spectrum".into()),
        title: Some("Third harmonic".into()),
        body: "Peak at **880 Hz**\nsecond line".into(),
        values: Some(NoteValues {
            tool: "spectrum".into(),
            label: "Spectrum @ 2.5 s".into(),
            text: "peak 880.0 Hz".into(),
            window: AnalysisWindow {
                start_secs: 0.0,
                end_secs: 4.0,
            },
            params: Default::default(),
            options: Default::default(),
            captured_ms: 2,
        }),
    };
    let timeline_note = Note {
        id: "n0".into(),
        created_ms: 1,
        updated_ms: 1,
        time_secs: 1.0,
        range: Some(AnalysisWindow {
            start_secs: 1.0,
            end_secs: 1.5,
        }),
        tool: None,
        title: None,
        body: "a timeline note".into(),
        values: None,
    };
    let save = SaveProject {
        name: "notes".into(),
        created_ms: None,
        source: None,
        setup: crate::project::AnalysisSetup::default(),
        layout: Value::Null,
        results: Vec::new(),
        notes: vec![chart_note, timeline_note],
        pcm: None,
    };
    let file = std::fs::File::create(&path).unwrap();
    write_project(std::io::BufWriter::new(file), &save, 10).unwrap();
    path.to_string_lossy().into_owned()
}

#[test]
fn notes_reads_the_file_and_flags() {
    let m = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("json", json!(true)),
        ("full", json!(true)),
    ]);
    let request = build_request("notes", &m).unwrap();
    match request.command {
        Command::Notes { path, json, full } => {
            assert_eq!(path, "/tmp/x.heyl");
            assert!(json);
            assert!(full);
        }
        _ => panic!("expected a notes command"),
    }
}

#[test]
fn notes_without_a_file_is_a_usage_error() {
    assert!(build_request("notes", &matches(&[]))
        .unwrap_err()
        .contains("project file"));
}

#[test]
fn run_lists_notes_sorted_by_time() {
    let path = write_project_file("hey_listen_cli_notes.heyl");

    // JSONL, full bodies.
    let m = matches(&[
        ("file", json!(path.clone())),
        ("json", json!(true)),
        ("full", json!(true)),
    ]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values.len(), 2);
    // Sorted by time: the timeline note (1.0 s) before the chart note (2.5 s).
    assert_eq!(values[0]["id"], "n0");
    assert_eq!(values[1]["id"], "n1");
    assert_eq!(values[1]["body"], "Peak at **880 Hz**\nsecond line");
    assert_eq!(values[1]["values"]["text"], "peak 880.0 Hz");

    // Table output, excerpted bodies.
    let m = matches(&[("file", json!(path.clone()))]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let table = String::from_utf8(out).unwrap();
    assert!(table.contains("2.500\tspectrum\tThird harmonic\tpeak 880.0 Hz"));
    assert!(table.contains("1.000–1.500\t-\ta timeline note\t"));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_reports_a_missing_project() {
    let m = matches(&[("file", json!("/no/such/x.heyl"))]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    let values = lines(&out);
    assert!(values[0]["error"].is_string());
}
