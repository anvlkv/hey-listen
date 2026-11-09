//! `project` and `compare --save` write a `.heyl` the app can open with its tabs and
//! comparison (M25.D).

use super::*;
use crate::audio::analyzers::{AnalyzerId, ToolId};
use crate::project::read_project;

fn project_request(out: String, source: String) -> Request {
    let mut request = analyze_request(Vec::new(), Vec::new());
    request.command = Command::ProjectSave {
        path: out,
        source: Some(source),
        synth: None,
        name: None,
        open_tools: vec![ToolId::Spectrum, ToolId::Waveform],
        annotations: vec![serde_json::json!({ "title": "n1", "body": "b", "timeSecs": 0.1 })],
        reference: false,
    };
    request
}

#[test]
fn project_save_writes_source_tabs_annotations_and_window() {
    let wav = std::env::temp_dir().join(format!("hey_cli_project_save_{}.wav", std::process::id()));
    write_sine_wav(&wav, 8_000, 8_000);
    let out_dir = std::env::temp_dir().join(format!("hey_cli_project_out_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out_dir);
    let out = out_dir.join("nested").join("song.heyl");

    let mut request = project_request(
        out.to_string_lossy().into_owned(),
        wav.to_string_lossy().into_owned(),
    );
    request.start = Some(0.1);
    request.end = Some(0.5);

    let value = run_single(&request);
    assert_eq!(value["openTools"], json!(["spectrum", "waveform"]));
    assert_eq!(value["annotations"], 1);

    let mut file = std::fs::File::open(&out).unwrap();
    let loaded = read_project(&mut file).unwrap();
    assert_eq!(
        loaded.setup.open_tools,
        vec![ToolId::Spectrum, ToolId::Waveform]
    );
    assert_eq!(loaded.setup.window.start_secs, 0.1);
    assert_eq!(loaded.setup.window.end_secs, 0.5);
    assert_eq!(loaded.annotations.len(), 1);
    assert!(loaded.pcm.is_some());

    let _ = std::fs::remove_dir_all(&out_dir);
    let _ = std::fs::remove_file(&wav);
}

#[test]
fn project_save_writes_a_reference_project() {
    let wav = std::env::temp_dir().join(format!("hey_cli_project_ref_{}.wav", std::process::id()));
    write_sine_wav(&wav, 8_000, 4_000);
    let out = std::env::temp_dir().join(format!("hey_cli_project_ref_{}.heyl", std::process::id()));

    let mut request = project_request(
        out.to_string_lossy().into_owned(),
        wav.to_string_lossy().into_owned(),
    );
    if let Command::ProjectSave { reference, .. } = &mut request.command {
        *reference = true;
    }
    run_single(&request);

    let mut file = std::fs::File::open(&out).unwrap();
    let loaded = read_project(&mut file).unwrap();
    assert!(loaded.pcm.is_none());
    let source = loaded.source.expect("a source descriptor");
    assert_eq!(source.kind, crate::project::SourceKind::File);
    // `open_audio_file` canonicalizes the path so a reference project can decode the
    // source again from any working directory; on macOS that resolves the `/var`
    // symlink to `/private/var`, so compare against the canonicalized path.
    let expected = std::fs::canonicalize(&wav).expect("canonicalize the wav");
    assert_eq!(source.path.as_deref(), expected.to_str());

    let _ = std::fs::remove_file(&out);
    let _ = std::fs::remove_file(&wav);
}

#[test]
fn compare_save_writes_the_owner_with_the_snapshot_and_tabs() {
    let a = super::compare::write_project_file("hey_cli_cmp_owner.heyl", 1.0, (0.0, 0.5));
    let b = super::compare::write_project_file("hey_cli_cmp_ref.heyl", 0.5, (0.0, 0.5));
    let out = std::env::temp_dir().join(format!("hey_cli_cmp_saved_{}.heyl", std::process::id()));

    let mut request = analyze_request(Vec::new(), vec!["spectrum".into()]);
    request.command = Command::Compare {
        a,
        b,
        save: Some(out.to_string_lossy().into_owned()),
        open_tools: vec![ToolId::Spectrum],
    };

    let mut buffer = Vec::new();
    assert_eq!(run(&request, &mut buffer), 0);

    let mut file = std::fs::File::open(&out).unwrap();
    let loaded = read_project(&mut file).unwrap();
    assert_eq!(loaded.compare.len(), 1);
    assert_eq!(loaded.compare[0].tool, AnalyzerId::Spectrum);
    assert_eq!(loaded.setup.open_tools, vec![ToolId::Spectrum]);
    assert!(loaded.pcm.is_some());

    let _ = std::fs::remove_file(&out);
}
