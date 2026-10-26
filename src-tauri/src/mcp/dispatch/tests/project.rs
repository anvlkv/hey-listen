//! Headless project-file tools: save from the session, open in a fresh session.

use serde_json::json;

use crate::project::{read_project, write_project, AnalysisSetup, SaveProject};

use super::super::HeadlessSession;
use super::sine_graph_value;

fn temp_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("hey_listen_mcp_{}_{name}", std::process::id()))
}

#[test]
fn save_project_writes_source_setup_and_notes() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 0.25 }),
        )
        .unwrap();
    session
        .dispatch(
            "set_shared_params",
            json!({ "params": { "fftSize": 1024 } }),
        )
        .unwrap();
    session
        .dispatch(
            "set_tool_options",
            json!({ "tool": "pitchYin", "options": { "minF0Hz": 40.0 } }),
        )
        .unwrap();
    session
        .dispatch("set_analysis_window", json!({ "start": 0.05, "end": 0.2 }))
        .unwrap();
    session
        .dispatch("set_view", json!({ "start": 0.0, "end": 0.25 }))
        .unwrap();

    let path = temp_path("project.heyl");
    let saved = session
        .dispatch(
            "save_project",
            json!({
                "path": path.to_string_lossy(),
                "name": "Test",
                "openTools": ["spectrogram", "nope"],
                "notes": [
                    {
                        "title": "n1",
                        "body": "hello",
                        "timeSecs": 0.1,
                        "range": { "startSecs": 0.05, "endSecs": 0.15 }
                    },
                    { "body": "second", "timeSecs": 0.2 }
                ],
            }),
        )
        .unwrap();
    assert_eq!(saved["notes"], 2);
    assert_eq!(saved["embedded"], true);

    let mut file = std::fs::File::open(&path).unwrap();
    let loaded = read_project(&mut file).unwrap();
    assert_eq!(loaded.meta.name, "Test");
    assert_eq!(loaded.setup.shared.fft_size, 1024);
    assert_eq!(loaded.setup.tool_options["pitchYin"]["minF0Hz"], 40.0);
    assert_eq!(loaded.setup.open_tools, vec!["spectrogram"]);
    assert_eq!(loaded.setup.window.start_secs, 0.05);
    assert_eq!(loaded.setup.view.end_secs, 0.25);
    assert_eq!(loaded.notes.len(), 2);
    assert_eq!(loaded.notes[0].title.as_deref(), Some("n1"));
    assert!(loaded.notes[1].id.starts_with("headless-"));
    assert!(loaded.pcm.is_some());
    let _ = std::fs::remove_file(&path);
}

#[test]
fn open_project_restores_the_session_and_new_project_clears_it() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 0.25 }),
        )
        .unwrap();
    session
        .dispatch("set_shared_params", json!({ "params": { "fftSize": 512 } }))
        .unwrap();
    session
        .dispatch("set_analysis_window", json!({ "start": 0.02, "end": 0.18 }))
        .unwrap();

    let path = temp_path("reopen.heyl");
    session
        .dispatch(
            "save_project",
            json!({ "path": path.to_string_lossy(), "notes": [] }),
        )
        .unwrap();

    let mut other = HeadlessSession::default();
    let state = other
        .dispatch("open_project", json!({ "path": path.to_string_lossy() }))
        .unwrap();
    assert_eq!(state["source"]["sampleRate"], 48_000);
    assert_eq!(state["window"]["start"], 0.02);
    assert_eq!(state["window"]["end"], 0.18);
    assert_eq!(state["params"]["fftSize"], 512);
    assert!(state["project"]["name"]
        .as_str()
        .unwrap()
        .ends_with("_reopen"));
    assert!(state["project"]["path"]
        .as_str()
        .unwrap()
        .ends_with("reopen.heyl"));

    let cleared = other.dispatch("new_project", json!({})).unwrap();
    assert!(cleared["source"].is_null());
    assert_eq!(cleared["window"]["start"], 0.0);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn save_project_reports_a_missing_path() {
    let mut session = HeadlessSession::default();
    let err = session.dispatch("save_project", json!({})).unwrap_err();
    assert!(err.contains("`path` is required"), "{err}");
}

#[test]
fn open_project_ignores_display_only_tool_options() {
    // A GUI save stores every tool option, including view toggles; headless must
    // ignore those instead of failing on an "unknown" engine key.
    let path = temp_path("display.heyl");
    let mut setup = AnalysisSetup::default();
    setup.tool_options.insert(
        "spectrum".to_string(),
        [("showMean".to_string(), 1.0), ("logFreq".to_string(), 1.0)]
            .into_iter()
            .collect(),
    );
    let save = SaveProject {
        name: "display".to_string(),
        created_ms: None,
        source: None,
        setup,
        layout: serde_json::Value::Null,
        results: Vec::new(),
        notes: Vec::new(),
        pcm: None,
    };
    let file = std::fs::File::create(&path).unwrap();
    write_project(file, &save, 1).unwrap();

    let mut session = HeadlessSession::default();
    session
        .dispatch("open_project", json!({ "path": path.to_string_lossy() }))
        .expect("display-only options are ignored");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn get_state_reports_the_server_mode_and_version() {
    let mut session = HeadlessSession::default();
    let state = session.dispatch("get_state", json!({})).unwrap();
    assert_eq!(state["server"]["mode"], "headless");
    assert_eq!(state["server"]["version"], env!("CARGO_PKG_VERSION"));
}
