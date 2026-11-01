//! `project` / `compare --save` / `notes` operation mapping (M25.D).

use super::*;
use crate::audio::analyzers::ToolId;

#[test]
fn project_maps_source_tabs_notes_and_window() {
    let notes_path =
        std::env::temp_dir().join(format!("hey_cli_project_notes_{}.json", std::process::id()));
    std::fs::write(
        &notes_path,
        json!([{ "title": "n1", "body": "b", "timeSecs": 0.1 }]).to_string(),
    )
    .unwrap();
    let m = matches(&[
        ("dest", json!("/tmp/out.heyl")),
        ("source", json!("/tmp/in.wav")),
        ("open-tool", json!(["spectrum", "waveform"])),
        ("notes", json!(notes_path.to_string_lossy())),
        ("start", json!("0.1")),
        ("end", json!("0.2")),
        ("reference", json!(true)),
    ]);
    let request = build_request("project", &m).unwrap();
    match &request.command {
        Command::ProjectSave {
            path,
            source,
            synth,
            open_tools,
            notes,
            reference,
            ..
        } => {
            assert_eq!(path, "/tmp/out.heyl");
            assert_eq!(source.as_deref(), Some("/tmp/in.wav"));
            assert!(synth.is_none());
            assert_eq!(open_tools, &[ToolId::Spectrum, ToolId::Waveform]);
            assert_eq!(notes.len(), 1);
            assert!(*reference);
        }
        other => panic!("unexpected command: {other:?}"),
    }
    assert_eq!(request.start, Some(0.1));
    assert_eq!(request.end, Some(0.2));
    let _ = std::fs::remove_file(notes_path);
}

#[test]
fn project_needs_exactly_one_source() {
    let no_source = matches(&[("dest", json!("/tmp/out.heyl"))]);
    assert!(build_request("project", &no_source)
        .unwrap_err()
        .contains("needs a source"));

    let both = matches(&[
        ("dest", json!("/tmp/out.heyl")),
        ("source", json!("/tmp/in.wav")),
        ("synth", json!("/tmp/graph.json")),
    ]);
    assert!(build_request("project", &both).is_err());
}

#[test]
fn compare_save_and_open_tools_are_mapped() {
    let m = matches(&[
        ("a", json!("a.heyl")),
        ("b", json!("b.heyl")),
        ("tool", json!(["spectrum"])),
        ("save", json!("out.heyl")),
        ("open-tool", json!(["spectrum"])),
    ]);
    let request = build_request("compare", &m).unwrap();
    match &request.command {
        Command::Compare {
            save, open_tools, ..
        } => {
            assert_eq!(save.as_deref(), Some("out.heyl"));
            assert_eq!(open_tools, &[ToolId::Spectrum]);
        }
        other => panic!("unexpected command: {other:?}"),
    }
}

#[test]
fn compare_open_tools_need_save() {
    let m = matches(&[
        ("a", json!("a.heyl")),
        ("b", json!("b.heyl")),
        ("tool", json!(["spectrum"])),
        ("open-tool", json!(["spectrum"])),
    ]);
    assert!(build_request("compare", &m)
        .unwrap_err()
        .contains("--open-tool"));
}
