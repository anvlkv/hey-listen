//! `migrate` upgrades project files in place (M37): a current file is left untouched, an
//! already-current reference project stays a reference unless `--embed`, and a rewrite
//! keeps a `.bak` sibling by default.

use std::io::Read;
use std::path::Path;

use super::*;
use hey_listen_lib::project::{
    read_project, write_project_atomic, SaveProject, SourceDescriptor, SourceKind, VERSION,
};

/// The committed **version-1** project (`e2e/fixtures/v1.heyl`), written by a 0.5.x build.
const LEGACY_V1: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../e2e/fixtures/v1.heyl");

fn temp(name: &str) -> String {
    std::env::temp_dir()
        .join(format!(
            "hey_cli_migrate_{name}_{}.heyl",
            std::process::id()
        ))
        .to_string_lossy()
        .into_owned()
}

/// A **reference** project (no `DATA`) at the current format version.
fn reference_project(name: &str, wav: &str) -> String {
    let path = temp(name);
    let save = SaveProject {
        name: name.to_string(),
        created_ms: Some(1),
        source: Some(SourceDescriptor {
            kind: SourceKind::File,
            path: Some(wav.to_string()),
            ..Default::default()
        }),
        setup: Default::default(),
        layout: serde_json::Value::Null,
        results: Vec::new(),
        annotations: Vec::new(),
        compare: Vec::new(),
        pcm: None,
    };
    write_project_atomic(Path::new(&path), &save, 2).expect("write the project");
    path
}

fn migrate_request(paths: Vec<String>, embed: bool, backup: bool) -> Request {
    Request {
        command: Command::Migrate {
            paths,
            embed,
            backup,
        },
        ..analyze_request(Vec::new(), Vec::new())
    }
}

fn bytes(path: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .unwrap()
        .read_to_end(&mut bytes)
        .unwrap();
    bytes
}

#[test]
fn the_console_maps_migrate_and_needs_a_file() {
    let request = crate::batch::clap_args::request([
        "hey-listen-cli",
        "migrate",
        "a.heyl",
        "b.heyl",
        "--embed",
        "--no-backup",
    ])
    .expect("the console mapping");
    match request.command {
        Command::Migrate {
            paths,
            embed,
            backup,
        } => {
            assert_eq!(paths, vec!["a.heyl".to_string(), "b.heyl".to_string()]);
            assert!(embed);
            assert!(!backup, "`--no-backup` turns the backup off");
        }
        other => panic!("unexpected command: {other:?}"),
    }

    assert!(crate::batch::clap_args::request(["hey-listen-cli", "migrate"]).is_err());
}

#[test]
fn a_current_project_is_left_untouched() {
    let path = reference_project("current", "/nonexistent/recording.wav");
    let before = bytes(&path);

    let value = run_single(&migrate_request(vec![path.clone()], false, true));
    assert_eq!(value["fromVersion"], json!(VERSION));
    assert_eq!(value["toVersion"], json!(VERSION));
    assert_eq!(value["migrated"], false);
    assert_eq!(value["embedded"], false);
    assert_eq!(value["backup"], json!(null));
    assert_eq!(value["dropped"], json!([]));
    assert_eq!(bytes(&path), before, "a current file is not rewritten");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn embed_grows_a_reference_project_and_keeps_a_backup() {
    let wav = std::env::temp_dir().join(format!("hey_cli_migrate_{}.wav", std::process::id()));
    write_sine_wav(&wav, 8_000, 4_000);
    let wav = wav.to_string_lossy().into_owned();

    let embedded = reference_project("embed", &wav);
    let value = run_single(&migrate_request(vec![embedded.clone()], true, true));
    assert_eq!(value["embedded"], true);
    assert_eq!(value["backup"], json!(format!("{embedded}.bak")));
    let mut file = std::fs::File::open(&embedded).unwrap();
    assert!(read_project(&mut file).unwrap().pcm.is_some());
    assert!(Path::new(&format!("{embedded}.bak")).exists());

    let plain = reference_project("embed-no-backup", &wav);
    let value = run_single(&migrate_request(vec![plain.clone()], true, false));
    assert_eq!(value["embedded"], true);
    assert_eq!(value["backup"], json!(null));
    assert!(!Path::new(&format!("{plain}.bak")).exists());

    let _ = std::fs::remove_file(&wav);
    for path in [embedded, plain] {
        let _ = std::fs::remove_file(format!("{path}.bak"));
        let _ = std::fs::remove_file(path);
    }
}

#[test]
fn a_v1_project_upgrades_in_place_with_a_backup() {
    let dir = std::env::temp_dir().join(format!("hey_cli_migrate_v1_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("legacy.heyl");
    std::fs::copy(LEGACY_V1, &file).unwrap();
    let path = file.to_string_lossy().into_owned();

    let value = run_single(&migrate_request(vec![path.clone()], false, true));
    assert_eq!(value["fromVersion"], 1);
    assert_eq!(value["toVersion"], json!(VERSION));
    assert_eq!(value["migrated"], true);
    assert_eq!(value["embedded"], true);
    assert_eq!(value["backup"], json!(format!("{path}.bak")));

    // The rewritten file is the current version, keeps its audio, and is no longer an
    // upgrade — while the backup still reads as version 1.
    let mut rewritten = std::fs::File::open(&path).unwrap();
    let loaded = read_project(&mut rewritten).unwrap();
    assert_eq!(loaded.format_version, VERSION);
    assert_eq!(loaded.upgraded_from, None);
    assert!(loaded.pcm.is_some());
    let mut backup = std::fs::File::open(format!("{path}.bak")).unwrap();
    assert_eq!(read_project(&mut backup).unwrap().format_version, 1);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_missing_file_is_an_error_record() {
    let mut out = Vec::new();
    let code = run(
        &migrate_request(vec!["/nonexistent/hey.heyl".to_string()], false, true),
        &mut out,
    );
    assert_eq!(code, 1);
    let records = lines(&out);
    assert_eq!(records.len(), 1);
    assert!(records[0]["error"].is_string());
}
