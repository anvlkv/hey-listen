//! Headless comparison (M25.D): diff the session against another project file, store
//! the snapshot, and save it back as `COMPARE`.

use serde_json::json;

use crate::project::read_project;

use super::super::HeadlessSession;
use super::sine_graph_value;

fn temp_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "hey_listen_mcp_compare_{}_{name}",
        std::process::id()
    ))
}

/// Write a small self-contained project (a rendered sine) and return its path.
fn write_reference(name: &str) -> std::path::PathBuf {
    let path = temp_path(name);
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 0.25 }),
        )
        .unwrap();
    session
        .dispatch(
            "save_project",
            json!({ "path": path.to_string_lossy(), "name": "Reference" }),
        )
        .unwrap();
    path
}

#[test]
fn compares_against_a_project_file_and_saves_the_snapshot() {
    let reference = write_reference("reference.heyl");

    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 0.25 }),
        )
        .unwrap();

    let result = session
        .dispatch(
            "compare_analysis",
            json!({
                "tool": "spectrum",
                "with": reference.to_string_lossy(),
                "summaryOnly": true,
            }),
        )
        .unwrap();
    assert_eq!(result["tool"], "spectrum");
    assert_eq!(result["b"]["project"], "Reference");
    assert!(result["a"]["summary"]["text"].is_string());
    assert!(result["diff"].is_object() || result["diff"].is_null());
    assert!(result["savedFingerprint"].is_string());

    // The comparison is now the session's saved reference, so `saved: true` works.
    let again = session
        .dispatch(
            "compare_analysis",
            json!({ "tool": "spectrum", "saved": true, "summaryOnly": true }),
        )
        .unwrap();
    assert_eq!(again["savedFingerprint"], result["savedFingerprint"]);

    // Saving the session writes the snapshot into the `COMPARE` section.
    let owner = temp_path("owner.heyl");
    session
        .dispatch(
            "save_project",
            json!({ "path": owner.to_string_lossy(), "name": "Owner" }),
        )
        .unwrap();
    let mut file = std::fs::File::open(&owner).unwrap();
    let loaded = read_project(&mut file).unwrap();
    assert_eq!(loaded.compare.len(), 1);
    assert_eq!(
        loaded.compare[0].tool,
        crate::audio::analyzers::AnalyzerId::Spectrum
    );
    assert_eq!(loaded.compare[0].reference_name, "Reference");

    let _ = std::fs::remove_file(&owner);
    let _ = std::fs::remove_file(&reference);
}

#[test]
fn compare_requires_a_reference_or_a_snapshot() {
    let mut session = HeadlessSession::default();
    let err = session
        .dispatch("compare_analysis", json!({ "tool": "spectrum" }))
        .unwrap_err();
    assert!(err.contains("`with`"), "{err}");

    let err = session
        .dispatch(
            "compare_analysis",
            json!({ "tool": "spectrum", "saved": true }),
        )
        .unwrap_err();
    assert!(err.contains("no saved comparison"), "{err}");
}

#[test]
fn compare_reports_an_unreadable_reference() {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 0.1 }),
        )
        .unwrap();
    let err = session
        .dispatch(
            "compare_analysis",
            json!({ "tool": "spectrum", "with": "/nonexistent/reference.heyl" }),
        )
        .unwrap_err();
    assert!(err.contains("cannot open"), "{err}");
}

#[test]
fn open_then_save_keeps_the_projects_open_tools() {
    let source = temp_path("with-tabs.heyl");
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 0.25 }),
        )
        .unwrap();
    session
        .dispatch(
            "save_project",
            json!({
                "path": source.to_string_lossy(),
                "openTools": ["spectrum", "waveform"],
            }),
        )
        .unwrap();

    // A fresh session opens it and saves without repeating `openTools`.
    let mut reopened = HeadlessSession::default();
    let state = reopened
        .dispatch("open_project", json!({ "path": source.to_string_lossy() }))
        .unwrap();
    assert_eq!(state["openTools"], json!(["spectrum", "waveform"]));

    let resaved = temp_path("with-tabs-resaved.heyl");
    reopened
        .dispatch("save_project", json!({ "path": resaved.to_string_lossy() }))
        .unwrap();
    let mut file = std::fs::File::open(&resaved).unwrap();
    let loaded = read_project(&mut file).unwrap();
    assert_eq!(
        loaded.setup.open_tools,
        vec![
            crate::audio::analyzers::ToolId::Spectrum,
            crate::audio::analyzers::ToolId::Waveform,
        ]
    );

    let _ = std::fs::remove_file(&source);
    let _ = std::fs::remove_file(&resaved);
}
