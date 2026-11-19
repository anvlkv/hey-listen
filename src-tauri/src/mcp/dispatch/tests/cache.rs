//! The headless session's analyzer result cache: written to the project file, seeded
//! back on `open_project`, and invalidated when it can no longer apply (D-22).

use serde_json::json;

use crate::audio::analysis::{AnalysisResult, StoredAnalysisResult};
use crate::audio::analyzers::AnalyzerId;
use crate::project::{read_project, write_project, LoadedProject, SaveProject};

use super::super::HeadlessSession;
use super::sine_graph_value;

fn temp_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "hey_listen_mcp_cache_{}_{name}",
        std::process::id()
    ))
}

/// A session whose source is one second of a 440 Hz sine at 48 kHz.
fn sine_session() -> HeadlessSession {
    let mut session = HeadlessSession::default();
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 1.0 }),
        )
        .unwrap();
    session
}

fn save(session: &mut HeadlessSession, path: &std::path::Path) {
    session
        .dispatch("save_project", json!({ "path": path.to_string_lossy() }))
        .unwrap();
}

fn load(path: &std::path::Path) -> LoadedProject {
    let mut file = std::fs::File::open(path).unwrap();
    read_project(&mut file).unwrap()
}

/// Put a marker in the cached `tool` payload — a value no real run produces — so a later
/// hit is unmistakable. The key (tool, window, params, options) is left untouched.
fn mark(session: &mut HeadlessSession, tool: AnalyzerId) {
    let entry = session
        .results
        .iter_mut()
        .find(|entry| entry.tool == tool)
        .expect("a cached entry");
    let mut result = AnalysisResult::from(
        postcard::from_bytes::<StoredAnalysisResult>(&entry.result).expect("decode"),
    );
    match &mut result {
        AnalysisResult::FrameRms(series) => series.values[0] = Some(-12_345.0),
        _ => panic!("the marked entry is not a frameRms result"),
    }
    entry.result = postcard::to_stdvec(&StoredAnalysisResult::from(&result)).expect("encode");
}

#[test]
fn a_headless_run_is_written_to_the_project_file() {
    let mut session = sine_session();
    session
        .dispatch("run_analysis", json!({ "tool": "frameRms" }))
        .unwrap();

    let path = temp_path("written.heyl");
    save(&mut session, &path);

    let loaded = load(&path);
    assert_eq!(loaded.results.len(), 1);
    let entry = &loaded.results[0];
    assert_eq!(entry.tool, AnalyzerId::FrameRms);
    assert_eq!(entry.start, loaded.setup.window.start_secs);
    assert_eq!(entry.end, loaded.setup.window.end_secs);
    assert!(
        !entry.result.is_empty(),
        "the payload is stored, not dropped"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn an_opened_project_reuses_its_saved_result() {
    let mut session = sine_session();
    session
        .dispatch("run_analysis", json!({ "tool": "frameRms" }))
        .unwrap();
    mark(&mut session, AnalyzerId::FrameRms);
    let path = temp_path("reused.heyl");
    save(&mut session, &path);

    let mut reopened = HeadlessSession::default();
    reopened
        .dispatch("open_project", json!({ "path": path.to_string_lossy() }))
        .unwrap();
    assert_eq!(
        reopened.results.len(),
        1,
        "the file's entries seed the cache"
    );

    let run = reopened
        .dispatch(
            "run_analysis",
            json!({ "tool": "frameRms", "includeData": true }),
        )
        .unwrap();
    assert_eq!(
        run["result"]["values"][0].as_f64(),
        Some(-12_345.0),
        "the seeded entry was reused instead of recomputed"
    );

    // A hit keeps the entry; a save writes exactly one, not a duplicate.
    save(&mut reopened, &path);
    assert_eq!(load(&path).results.len(), 1);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_new_source_drops_the_cached_results() {
    let mut session = sine_session();
    session
        .dispatch("run_analysis", json!({ "tool": "frameRms" }))
        .unwrap();
    mark(&mut session, AnalyzerId::FrameRms);

    // Rendering the synth again replaces the source, so the entry no longer applies.
    session
        .dispatch(
            "render_synth",
            json!({ "graph": sine_graph_value(), "seconds": 1.0 }),
        )
        .unwrap();
    assert!(session.results.is_empty());

    let run = session
        .dispatch(
            "run_analysis",
            json!({ "tool": "frameRms", "includeData": true }),
        )
        .unwrap();
    assert_ne!(run["result"]["values"][0].as_f64(), Some(-12_345.0));
    assert_eq!(session.results.len(), 1, "the fresh run is cached");
}

#[test]
fn a_filter_change_or_a_new_project_clears_the_cache() {
    let mut session = sine_session();
    session
        .dispatch("run_analysis", json!({ "tool": "frameRms" }))
        .unwrap();

    // A stored entry carries no filter, so any filter change invalidates.
    session
        .dispatch("set_filter_graph", json!({ "enabled": false }))
        .unwrap();
    assert!(session.results.is_empty());

    session
        .dispatch("run_analysis", json!({ "tool": "frameRms" }))
        .unwrap();
    assert_eq!(session.results.len(), 1);
    session.dispatch("new_project", json!({})).unwrap();
    assert!(session.results.is_empty());
}

#[test]
fn a_corrupt_payload_falls_back_to_a_real_run() {
    let mut session = sine_session();
    session
        .dispatch("run_analysis", json!({ "tool": "frameRms" }))
        .unwrap();
    let path = temp_path("corrupt.heyl");
    save(&mut session, &path);

    // Corrupt the payload but keep the key: the entry still matches, so the run must fall
    // through to the engine instead of failing.
    let mut loaded = load(&path);
    loaded.results[0].result = vec![0xde, 0xad, 0xbe, 0xef];
    let rewritten = SaveProject::from_loaded(&loaded);
    write_project(std::fs::File::create(&path).unwrap(), &rewritten, 1).unwrap();

    let mut reopened = HeadlessSession::default();
    reopened
        .dispatch("open_project", json!({ "path": path.to_string_lossy() }))
        .unwrap();
    let run = reopened
        .dispatch(
            "run_analysis",
            json!({ "tool": "frameRms", "includeData": true }),
        )
        .expect("a corrupt entry is a miss, not an error");
    assert!(run["result"]["values"][0].as_f64().is_some());

    // The real run replaced the corrupt payload under the same key.
    assert_eq!(reopened.results.len(), 1);
    let bytes = &reopened.results[0].result;
    assert!(postcard::from_bytes::<StoredAnalysisResult>(bytes).is_ok());
    let _ = std::fs::remove_file(&path);
}
