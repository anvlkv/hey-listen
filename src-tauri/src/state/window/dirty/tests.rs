//! The dirty signature's behaviour: the settle/baseline clock, the forced-dirty upgrade
//! marker, and the compare-view input. The loop is driven by hand here (no window, no
//! timers), so `settle` pays one real `SETTLE_MS` wait.

use super::*;

fn tracker() -> ProjectDirty {
    ProjectDirty::new(Arc::new(Mutex::new(None)))
}

/// Run the settle loop by hand until the baseline locks (a real `SETTLE_MS` wait).
fn settle(dirty: &ProjectDirty) {
    dirty.begin_baseline();
    dirty.end_baseline();
    let deadline = Instant::now() + SETTLE_MS * 4;
    while dirty.baselining() {
        dirty.tick();
        std::thread::sleep(Duration::from_millis(TICK_MS));
        assert!(Instant::now() < deadline, "the baseline never settled");
    }
}

fn named(name: &str) -> crate::state::ProjectSnapshot {
    crate::state::ProjectSnapshot {
        name: name.into(),
        ..crate::state::ProjectSnapshot::default()
    }
}

/// The regression this guards: restoring a layout in a differently sized window changed
/// only the pixel sizes and made a freshly loaded project look dirty.
#[test]
fn a_viewport_resize_does_not_change_the_signature() {
    let dirty = tracker();
    let snapshot = |width: i64| crate::state::ProjectSnapshot {
        layout: serde_json::json!({
            "dockview": { "grid": { "width": width, "height": 720, "root": { "size": 500 } } },
            "graphs": {},
        }),
        ..crate::state::ProjectSnapshot::default()
    };
    dirty.note_snapshot(&snapshot(1440));
    let first = dirty.signature();

    dirty.note_snapshot(&snapshot(1280));
    assert_eq!(first, dirty.signature());
}

#[test]
fn a_real_edit_changes_the_signature() {
    let dirty = tracker();
    dirty.note_snapshot(&named("base"));
    let first = dirty.signature();
    dirty.note_snapshot(&named("edited"));
    assert_ne!(first, dirty.signature());
}

#[test]
fn an_upgraded_project_reads_dirty_until_it_is_saved() {
    let dirty = tracker();
    // The app starts clean once the first settle locks the baseline.
    settle(&dirty);
    assert!(!dirty.dirty());

    dirty.set_upgraded_from(Some(3));
    assert!(dirty.dirty());
    dirty.mark_clean();
    assert!(dirty.dirty(), "an upgrade stays dirty after a rebase");

    // A save clears the marker; nothing else differs from the baseline, so the project is
    // clean again.
    dirty.set_upgraded_from(None);
    assert!(!dirty.dirty());
}

#[test]
fn an_edit_after_the_settle_is_dirty() {
    let dirty = tracker();
    dirty.note_snapshot(&named("base"));
    settle(&dirty);
    assert!(!dirty.dirty());

    dirty.note_snapshot(&named("edited"));
    assert!(dirty.dirty_now());

    dirty.mark_clean();
    assert!(!dirty.dirty());
}

/// A change made while restoring is not an edit: the baseline follows it and the project
/// still settles clean.
#[test]
fn a_restore_that_keeps_settling_stays_clean() {
    let dirty = tracker();
    dirty.note_snapshot(&named("previous"));
    settle(&dirty);

    dirty.begin_baseline();
    dirty.note_snapshot(&named("loaded"));
    assert!(!dirty.dirty_now(), "a restoring change is not an edit");
    settle(&dirty);
    assert!(!dirty.dirty());

    dirty.note_snapshot(&named("edited after the load"));
    assert!(dirty.dirty_now());
}

#[test]
fn the_compare_signature_is_part_of_the_signature() {
    let dirty = tracker();
    let first = dirty.signature();
    dirty.set_compare_signature(serde_json::json!({ "c1": "live|other|0.000000|abc" }));
    assert_ne!(first, dirty.signature());
}
