//! Headless data exports (M12): `export_analysis` / `export_all`, and the GUI-only
//! chart-image answer.

use serde_json::{json, Value};

use super::*;

fn synth_session() -> HeadlessSession {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 1.0 }),
        )
        .unwrap();
    session
}

#[test]
fn export_analysis_renders_text_without_writing_a_file() {
    let mut session = synth_session();

    let json_out = session
        .dispatch("export_analysis", json!({ "tool": "spectrum" }))
        .unwrap();
    assert_eq!(json_out["format"], "json");
    assert_eq!(json_out["fileName"], "Synth.spectrum.json");
    assert!(json_out.get("sidecar").is_none());
    let envelope: Value = serde_json::from_str(json_out["text"].as_str().unwrap()).unwrap();
    assert_eq!(envelope["kind"], "hey-listen.analysis");
    assert_eq!(envelope["tool"], "spectrum");
    assert_eq!(envelope["source"]["kind"], "synth");
    assert_eq!(envelope["source"]["sampleRate"], 48_000);
    assert_eq!(envelope["result"]["tool"], "spectrum");
    assert_eq!(envelope["window"]["startSecs"], 0.0);

    let csv = session
        .dispatch(
            "export_analysis",
            json!({ "tool": "levels", "format": "csv" }),
        )
        .unwrap();
    assert_eq!(csv["format"], "csv");
    assert!(csv["text"].as_str().unwrap().starts_with("key,value\n"));
    let sidecar = csv["sidecar"].as_str().unwrap();
    assert!(sidecar.contains("\"tool\": \"levels\""), "{sidecar}");
    assert!(!sidecar.contains("\"result\""), "{sidecar}");
}

#[test]
fn export_analysis_writes_the_file_and_its_sidecar() {
    let mut session = synth_session();
    let dir = std::env::temp_dir().join("hey_listen_mcp_export");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("analysis.csv");

    let out = session
        .dispatch(
            "export_analysis",
            json!({ "tool": "levels", "format": "csv", "path": path.to_string_lossy() }),
        )
        .unwrap();
    assert_eq!(out["path"], path.to_string_lossy().as_ref());
    assert!(path.exists());
    let sidecar = std::path::PathBuf::from(out["sidecarPath"].as_str().unwrap());
    assert!(sidecar.exists());
    assert!(sidecar.to_string_lossy().ends_with("analysis.meta.json"));

    // `includeSidecar: false` still returns the sidecar text but writes no file.
    let json_path = dir.join("analysis.json");
    let out = session
        .dispatch(
            "export_analysis",
            json!({ "tool": "levels", "path": json_path.to_string_lossy(), "includeSidecar": false }),
        )
        .unwrap();
    assert!(json_path.exists());
    assert!(out.get("sidecarPath").is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn export_all_writes_each_requested_tool() {
    let mut session = synth_session();
    let dir = std::env::temp_dir().join("hey_listen_mcp_export_all");
    let _ = std::fs::remove_dir_all(&dir);

    let out = session
        .dispatch(
            "export_all",
            json!({
                "tools": ["levels", "spectrum"],
                "dir": dir.to_string_lossy(),
                "formats": ["json", "csv"],
            }),
        )
        .unwrap();
    let files = out["files"].as_array().unwrap();
    assert_eq!(files.len(), 4);
    for file in files {
        assert!(std::path::Path::new(file["path"].as_str().unwrap()).exists());
    }
    assert!(dir.join("Synth.levels.csv").exists());
    assert!(dir.join("Synth.levels.meta.json").exists());
    assert!(dir.join("Synth.spectrum.json").exists());
    let _ = std::fs::remove_dir_all(&dir);

    // Headless has no open-tab set, so the tool list is required.
    let error = session
        .dispatch("export_all", json!({ "dir": dir.to_string_lossy() }))
        .unwrap_err();
    assert!(error.contains("`tools` is required"), "{error}");
}

#[test]
fn export_chart_needs_the_rendered_canvas() {
    let mut session = synth_session();
    let error = session
        .dispatch("export_chart", json!({ "tool": "spectrum" }))
        .unwrap_err();
    assert!(error.contains("rendered canvas"), "{error}");
}
