//! Launch tests (split from `mod.rs` for the source-size budget).

use super::*;
use std::path::{Path, PathBuf};

fn target() -> AppTarget {
    AppTarget::new(PathBuf::from("/opt/hey-listen"), false)
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// Nothing is running: this is the one case that starts the GUI.
#[test]
fn nothing_running_starts_the_gui() {
    assert_eq!(
        decide(AppState::Absent, false, Some(&target())),
        Step::StartGui
    );
}

/// A serving app is bridged, never duplicated.
#[test]
fn a_live_app_is_attached_not_launched() {
    assert_eq!(decide(AppState::Live, false, Some(&target())), Step::Attach);
}

/// A recorded, alive app process (relaunching, still starting, or with the MCP server
/// switched off) is left alone.
#[test]
fn a_starting_app_is_left_alone() {
    assert_eq!(
        decide(AppState::Starting, false, Some(&target())),
        Step::LeaveRunning
    );
    let mut launcher = Launcher::new(Some(target()));
    assert!(
        !launcher.ensure_with(AppState::Starting, |_| panic!("must not start the app")),
        "a starting app is not a reason to wait for a launched one"
    );
}

/// The helper's "no app binary found" path: `current_target` answered `None`, so there is
/// nothing to start and the entry serves headless.
#[test]
fn a_helper_that_finds_no_app_serves_headless() {
    assert_eq!(decide(AppState::Absent, false, None), Step::Headless);
    let mut launcher = Launcher::new(None);
    assert!(!launcher.ensure_with(AppState::Absent, |_| panic!("no target to start")));
}

/// One launch per bridge process, however the caller asks.
#[test]
fn the_gui_is_started_at_most_once() {
    let mut launcher = Launcher::new(Some(target()));
    let mut calls = 0;
    let mut count = |_: &AppTarget| -> std::io::Result<()> {
        calls += 1;
        Ok(())
    };
    assert!(launcher.ensure_with(AppState::Absent, &mut count));
    assert!(
        !launcher.ensure_with(AppState::Absent, &mut count),
        "the second decision has nothing left to start"
    );
    assert_eq!(calls, 1);
}

/// A failed spawn is latched too: no retry, and the entry serves headless.
#[test]
fn a_failed_spawn_is_not_retried() {
    let mut launcher = Launcher::new(Some(target()));
    let mut calls = 0;
    let mut fail = |_: &AppTarget| -> std::io::Result<()> {
        calls += 1;
        Err(std::io::Error::other("no permission"))
    };
    assert!(!launcher.ensure_with(AppState::Absent, &mut fail));
    assert!(!launcher.ensure_with(AppState::Absent, &mut fail));
    assert_eq!(calls, 1);
}

/// The helper finds the app next to itself (the dev `target/debug/` layout) and starts
/// it through its own path.
#[test]
fn the_app_is_found_beside_the_helper() {
    let dir = temp_dir("hey_listen_launch_beside");
    let helper = dir.join(HELPER_BIN);
    std::fs::write(&helper, b"helper").expect("helper");
    std::fs::write(dir.join("hey-listen"), b"app").expect("app");

    let found = AppTarget::locate_in(&helper, &[]).expect("the sibling app");
    assert_eq!(found.exe(), dir.join("hey-listen"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// A helper with no app beside it and no search roots has no launch target, so the entry
/// goes headless instead of guessing at a path.
#[test]
fn a_helper_without_an_app_binary_has_no_target() {
    let dir = temp_dir("hey_listen_launch_missing");
    let helper = dir.join(HELPER_BIN);
    std::fs::write(&helper, b"helper").expect("helper");

    assert!(AppTarget::locate_in(&helper, &[]).is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

/// A helper inside an installed `Contents/MacOS/` is resolved through the bundle: the
/// search roots name `.app` bundles, and only the executable inside them is a target.
#[test]
fn an_installed_bundle_is_searched_by_its_contents() {
    let dir = temp_dir("hey_listen_launch_bundle");
    let bundle = dir.join("Hey Listen.app");
    let macos = bundle.join("Contents/MacOS");
    std::fs::create_dir_all(&macos).expect("bundle");
    let helper = dir.join(HELPER_BIN);
    std::fs::write(&helper, b"helper").expect("helper");
    std::fs::write(macos.join("hey-listen"), b"app").expect("app");

    let found = AppTarget::locate_in(&helper, std::slice::from_ref(&bundle)).expect("bundled app");
    assert_eq!(found.exe(), macos.join("hey-listen"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// The helper itself is the only binary that has to search; the app binary is its own
/// launch target.
#[test]
fn the_helper_binary_name_is_recognised() {
    assert_eq!(
        Path::new("/tmp/heylisten-mcp").file_stem(),
        Some(std::ffi::OsStr::new(HELPER_BIN))
    );
    assert_ne!(
        Path::new("/tmp/hey-listen").file_stem(),
        Some(std::ffi::OsStr::new(HELPER_BIN))
    );
}
