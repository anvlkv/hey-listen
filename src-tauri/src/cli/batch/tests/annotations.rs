//! `annotations` — reading a saved project's annotations.

use super::*;
use serde_json::{json, Value};

/// Write a `.heyl` with two annotations (a chart annotation with values, a timeline range annotation).
fn write_project_file(name: &str) -> String {
    use crate::project::sections::{AnalysisWindow, AnnotationValues};
    use crate::project::{write_project, Annotation, SaveProject};
    let path = std::env::temp_dir().join(name);
    let chart_annotation = Annotation {
        id: "n1".into(),
        created_ms: 1,
        updated_ms: 2,
        time_secs: 2.5,
        range: None,
        tool: Some(crate::audio::analyzers::AnalyzerId::Spectrum),
        title: Some("Third harmonic".into()),
        body: "Peak at **880 Hz**\nsecond line".into(),
        values: Some(AnnotationValues {
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
    let timeline_annotation = Annotation {
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
        body: "a timeline annotation".into(),
        values: None,
    };
    let save = SaveProject {
        name: "annotations".into(),
        created_ms: None,
        source: None,
        setup: crate::project::AnalysisSetup::default(),
        layout: Value::Null,
        results: Vec::new(),
        annotations: vec![chart_annotation, timeline_annotation],
        compare: Vec::new(),
        pcm: None,
    };
    let file = std::fs::File::create(&path).unwrap();
    write_project(std::io::BufWriter::new(file), &save, 10).unwrap();
    path.to_string_lossy().into_owned()
}

/// Run an `annotations` request and return its JSONL records.
fn run_annotations(m: &Matches) -> Vec<Value> {
    let request = build_request("annotations", m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    lines(&out)
}

/// List every annotation as JSON with full bodies.
fn list_json_full(path: &str) -> Vec<Value> {
    run_annotations(&matches(&[
        ("file", json!(path)),
        ("json", json!(true)),
        ("full", json!(true)),
    ]))
}

/// Run an `annotations` request that is expected to fail, returning its records.
fn run_annotations_error(m: &Matches) -> Vec<Value> {
    let request = build_request("annotations", m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    lines(&out)
}

#[test]
fn annotations_reads_the_file_and_flags() {
    let m = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("json", json!(true)),
        ("full", json!(true)),
    ]);
    let request = build_request("annotations", &m).unwrap();
    match request.command {
        Command::Annotations {
            path,
            json,
            full,
            op,
            to,
        } => {
            assert_eq!(path, "/tmp/x.heyl");
            assert!(json);
            assert!(full);
            assert!(matches!(op, AnnotationsOp::List));
            assert!(to.is_none());
        }
        _ => panic!("expected annotations command"),
    }
}

#[test]
fn annotations_add_maps_add_and_to() {
    let m = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("add", json!("/tmp/annotations.json")),
        ("to", json!("/tmp/copy.heyl")),
    ]);
    let request = build_request("annotations", &m).unwrap();
    match request.command {
        Command::Annotations { op, to, .. } => {
            assert!(matches!(op, AnnotationsOp::Add { file } if file == "/tmp/annotations.json"));
            assert_eq!(to.as_deref(), Some("/tmp/copy.heyl"));
        }
        _ => panic!("expected annotations command"),
    }
}

#[test]
fn annotations_get_update_delete_are_mutually_exclusive() {
    let get = matches(&[("file", json!("/tmp/x.heyl")), ("get", json!("n1"))]);
    assert!(matches!(
        build_request("annotations", &get).unwrap().command,
        Command::Annotations {
            op: AnnotationsOp::Get { id },
            ..
        } if id == "n1"
    ));

    let update = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("update", json!("n1")),
        ("set", json!(["title=New", "range=1,2", "tool=none"])),
    ]);
    match build_request("annotations", &update).unwrap().command {
        Command::Annotations {
            op: AnnotationsOp::Update { id, patch },
            ..
        } => {
            assert_eq!(id, "n1");
            assert_eq!(patch.len(), 3);
        }
        _ => panic!("expected an update operation"),
    }

    let delete = matches(&[("file", json!("/tmp/x.heyl")), ("delete", json!("n1"))]);
    assert!(matches!(
        build_request("annotations", &delete).unwrap().command,
        Command::Annotations {
            op: AnnotationsOp::Delete { id },
            ..
        } if id == "n1"
    ));

    let both = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("get", json!("n1")),
        ("delete", json!("n1")),
    ]);
    assert!(build_request("annotations", &both).is_err());

    let set_without_update = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("set", json!(["title=New"])),
    ]);
    assert!(build_request("annotations", &set_without_update).is_err());
}

#[test]
fn annotations_to_needs_add_and_add_needs_no_list_flags() {
    let to_only = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("to", json!("/tmp/copy.heyl")),
    ]);
    assert!(build_request("annotations", &to_only)
        .unwrap_err()
        .contains("--to"));

    let list_flag = matches(&[
        ("file", json!("/tmp/x.heyl")),
        ("add", json!("/tmp/annotations.json")),
        ("json", json!(true)),
    ]);
    assert!(build_request("annotations", &list_flag).is_err());
}

#[test]
fn annotations_without_a_file_is_a_usage_error() {
    assert!(build_request("annotations", &matches(&[]))
        .unwrap_err()
        .contains("project file"));
}

#[test]
fn run_lists_annotations_sorted_by_time() {
    let path = write_project_file("hey_listen_cli_annotations.heyl");

    // JSONL, full bodies.
    let values = list_json_full(&path);
    assert_eq!(values.len(), 2);
    // Sorted by time: the timeline annotation (1.0 s) before the chart annotation (2.5 s).
    assert_eq!(values[0]["id"], "n0");
    assert_eq!(values[1]["id"], "n1");
    assert_eq!(values[1]["body"], "Peak at **880 Hz**\nsecond line");
    assert_eq!(values[1]["values"]["text"], "peak 880.0 Hz");

    // Table output, excerpted bodies.
    let m = matches(&[("file", json!(path.clone()))]);
    let request = build_request("annotations", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let table = String::from_utf8(out).unwrap();
    assert!(table.contains("2.500\tspectrum\tThird harmonic\tpeak 880.0 Hz"));
    assert!(table.contains("1.000–1.500\t-\ta timeline annotation\t"));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_adds_annotations_in_place() {
    let path = write_project_file("hey_listen_cli_annotations_add.heyl");
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
    let request = build_request("annotations", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let record = lines(&out);
    assert_eq!(record[0]["added"], 1);
    assert_eq!(record[0]["annotations"], 3);

    // Read back: the two originals plus the added annotation.
    let values = list_json_full(&path);
    assert_eq!(values.len(), 3);
    assert_eq!(values[2]["title"], "added");

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&add);
}

#[test]
fn run_adds_annotations_to_a_copy() {
    let path = write_project_file("hey_listen_cli_annotations_copy.heyl");
    let copy = std::env::temp_dir().join(format!(
        "hey_listen_cli_annotations_copy_out_{}.heyl",
        std::process::id()
    ));
    let add = std::env::temp_dir().join(format!(
        "hey_listen_cli_add_copy_{}.json",
        std::process::id()
    ));
    std::fs::write(
        &add,
        json!([{ "body": "copy annotation", "timeSecs": 0.5 }]).to_string(),
    )
    .unwrap();

    let m = matches(&[
        ("file", json!(path.clone())),
        ("add", json!(add.to_string_lossy())),
        ("to", json!(copy.to_string_lossy())),
    ]);
    let request = build_request("annotations", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    assert!(copy.exists());

    // The copy has three annotations; the original is untouched.
    let read = |file: &str| {
        let m = matches(&[("file", json!(file)), ("json", json!(true))]);
        let request = build_request("annotations", &m).unwrap();
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
fn run_gets_one_annotation() {
    let path = write_project_file("hey_listen_cli_annotations_get.heyl");
    let m = matches(&[("file", json!(path.clone())), ("get", json!("n1"))]);
    let request = build_request("annotations", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let values = lines(&out);
    assert_eq!(values[0]["id"], "n1");
    assert_eq!(values[0]["body"], "Peak at **880 Hz**\nsecond line");

    let missing = matches(&[("file", json!(path.clone())), ("get", json!("nope"))]);
    assert!(run_annotations_error(&missing)[0]["error"].is_string());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_updates_an_annotation() {
    let path = write_project_file("hey_listen_cli_annotations_update.heyl");
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
    let request = build_request("annotations", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let record = lines(&out);
    assert_eq!(record[0]["annotation"]["title"], "Renamed");
    assert_eq!(record[0]["annotation"]["timeSecs"], 1.25);
    assert_eq!(record[0]["annotation"]["range"], Value::Null);
    assert_eq!(record[0]["annotation"]["tool"], "spectrum");

    // Persisted to the file.
    let m = matches(&[("file", json!(path.clone())), ("get", json!("n0"))]);
    let request = build_request("annotations", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    assert_eq!(lines(&out)[0]["title"], "Renamed");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_deletes_an_annotation() {
    let path = write_project_file("hey_listen_cli_annotations_delete.heyl");
    let m = matches(&[("file", json!(path.clone())), ("delete", json!("n0"))]);
    let request = build_request("annotations", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 0);
    let record = lines(&out);
    assert_eq!(record[0]["deleted"], "n0");
    assert_eq!(record[0]["annotations"], 1);

    // Deleting it again reports the missing id instead of a silent success.
    assert!(run_annotations_error(&m)[0]["error"].is_string());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn run_reports_a_missing_project() {
    let m = matches(&[("file", json!("/no/such/x.heyl"))]);
    let request = build_request("annotations", &m).unwrap();
    let mut out = Vec::new();
    assert_eq!(run(&request, &mut out), 1);
    let values = lines(&out);
    assert!(values[0]["error"].is_string());
}
