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
        tool: Some(crate::audio::analyzers::AnalyzerId::Spectrum),
        title: Some("Third harmonic".into()),
        body: "Peak at **880 Hz**\nsecond line".into(),
        values: Some(NoteValues {
            tool: crate::audio::analyzers::AnalyzerId::Spectrum,
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
        compare: Vec::new(),
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
        Command::Notes {
            path,
            json,
            full,
            op,
            to,
        } => {
            assert_eq!(path, "/tmp/x.heyl");
            assert!(json);
            assert!(full);
            assert!(matches!(op, NotesOp::List));
            assert!(to.is_none());
        }
        _ => panic!("expected a notes command"),
    }
}

#[test]
fn notes_add_maps_add_and_to() {
    let m = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("add", json!("/tmp/notes.json")),
        ("to", json!("/tmp/copy.heyl")),
    ]);
    let request = build_request("notes", &m).unwrap();
    match request.command {
        Command::Notes { op, to, .. } => {
            assert!(matches!(op, NotesOp::Add { file } if file == "/tmp/notes.json"));
            assert_eq!(to.as_deref(), Some("/tmp/copy.heyl"));
        }
        _ => panic!("expected a notes command"),
    }
}

#[test]
fn notes_get_update_delete_are_mutually_exclusive() {
    let get = matches(&[("file", json!("/tmp/x.heyl")), ("get", json!("n1"))]);
    assert!(matches!(
        build_request("notes", &get).unwrap().command,
        Command::Notes {
            op: NotesOp::Get { id },
            ..
        } if id == "n1"
    ));

    let update = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("update", json!("n1")),
        ("set", json!(["title=New", "range=1,2", "tool=none"])),
    ]);
    match build_request("notes", &update).unwrap().command {
        Command::Notes {
            op: NotesOp::Update { id, patch },
            ..
        } => {
            assert_eq!(id, "n1");
            assert_eq!(patch.len(), 3);
        }
        _ => panic!("expected an update operation"),
    }

    let delete = matches(&[("file", json!("/tmp/x.heyl")), ("delete", json!("n1"))]);
    assert!(matches!(
        build_request("notes", &delete).unwrap().command,
        Command::Notes {
            op: NotesOp::Delete { id },
            ..
        } if id == "n1"
    ));

    let both = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("get", json!("n1")),
        ("delete", json!("n1")),
    ]);
    assert!(build_request("notes", &both).is_err());

    let set_without_update = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("set", json!(["title=New"])),
    ]);
    assert!(build_request("notes", &set_without_update).is_err());
}

#[test]
fn notes_to_needs_add_and_add_needs_no_list_flags() {
    let to_only = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("to", json!("/tmp/copy.heyl")),
    ]);
    assert!(build_request("notes", &to_only)
        .unwrap_err()
        .contains("--to"));

    let list_flag = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("add", json!("/tmp/notes.json")),
        ("json", json!(true)),
    ]);
    assert!(build_request("notes", &list_flag).is_err());
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
fn run_adds_notes_in_place() {
    let path = write_project_file("hey_listen_cli_notes_add.heyl");
    let add = std::env::temp_dir().join(format!("hey_listen_cli_add_{}.json", std::process::id()));
    std::fs::write(
        &add,
        json!([{ "title": "added", "body": "new", "timeSecs": 3.0 }]).to_string(),
    )
    .unwrap();

    let m = matches(&[
        ("file", json!(path.clone())),
        ("add", json!(add.to_string_lossy())),
    ]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let record = lines(&out);
    assert_eq!(record[0]["added"], 1);
    assert_eq!(record[0]["notes"], 3);

    // Read back: the two originals plus the added note.
    let m = matches(&[
        ("file", json!(path.clone())),
        ("json", json!(true)),
        ("full", json!(true)),
    ]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values.len(), 3);
    assert_eq!(values[2]["title"], "added");

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&add);
}

#[test]
fn run_adds_notes_to_a_copy() {
    let path = write_project_file("hey_listen_cli_notes_copy.heyl");
    let copy = std::env::temp_dir().join(format!(
        "hey_listen_cli_notes_copy_out_{}.heyl",
        std::process::id()
    ));
    let add = std::env::temp_dir().join(format!(
        "hey_listen_cli_add_copy_{}.json",
        std::process::id()
    ));
    std::fs::write(
        &add,
        json!([{ "body": "copy note", "timeSecs": 0.5 }]).to_string(),
    )
    .unwrap();

    let m = matches(&[
        ("file", json!(path.clone())),
        ("add", json!(add.to_string_lossy())),
        ("to", json!(copy.to_string_lossy())),
    ]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    assert!(copy.exists());

    // The copy has three notes; the original is untouched.
    let read = |file: &str| {
        let m = matches(&[("file", json!(file)), ("json", json!(true))]);
        let request = build_request("notes", &m).unwrap();
        let mut out = Vec::new();
        assert_eq!(run(&request, &mut out), 0);
        lines(&out).len()
    };
    assert_eq!(read(&copy.to_string_lossy()), 3);
    assert_eq!(read(&path), 2);

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&copy);
    let _ = std::fs::remove_file(&add);
}

#[test]
fn run_gets_one_note() {
    let path = write_project_file("hey_listen_cli_notes_get.heyl");
    let m = matches(&[("file", json!(path.clone())), ("get", json!("n1"))]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values[0]["id"], "n1");
    assert_eq!(values[0]["body"], "Peak at **880 Hz**\nsecond line");

    let missing = matches(&[("file", json!(path.clone())), ("get", json!("nope"))]);
    let request = build_request("notes", &missing).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    assert!(lines(&out)[0]["error"].is_string());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_updates_a_note() {
    let path = write_project_file("hey_listen_cli_notes_update.heyl");
    let m = matches(&[
        ("file", json!(path.clone())),
        ("update", json!("n0")),
        (
            "set",
            json!([
                "title=Renamed",
                "timeSecs=1.25",
                "range=none",
                "tool=spectrum"
            ]),
        ),
    ]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let record = lines(&out);
    assert_eq!(record[0]["note"]["title"], "Renamed");
    assert_eq!(record[0]["note"]["timeSecs"], 1.25);
    assert_eq!(record[0]["note"]["range"], Value::Null);
    assert_eq!(record[0]["note"]["tool"], "spectrum");

    // Persisted to the file.
    let m = matches(&[("file", json!(path.clone())), ("get", json!("n0"))]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    assert_eq!(lines(&out)[0]["title"], "Renamed");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_deletes_a_note() {
    let path = write_project_file("hey_listen_cli_notes_delete.heyl");
    let m = matches(&[("file", json!(path.clone())), ("delete", json!("n0"))]);
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let record = lines(&out);
    assert_eq!(record[0]["deleted"], "n0");
    assert_eq!(record[0]["notes"], 1);

    // Deleting it again reports the missing id instead of a silent success.
    let request = build_request("notes", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    assert!(lines(&out)[0]["error"].is_string());
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
