//! The pure half of the live-source watcher: the settle/emit decisions, with the clock
//! supplied by the test instead of `Instant::now()`.

use std::time::{Duration, Instant, SystemTime};

use super::{SourceWatchReason, Stamp, WatchState, SETTLE};

/// A stamp whose modification time and length both vary with `len`.
fn stamp(len: u64) -> Stamp {
    Stamp {
        modified: Some(SystemTime::UNIX_EPOCH + Duration::from_secs(len)),
        len,
    }
}

/// A watcher armed on `stamp(1)`, then told 250 ms later that the file vanished.
fn vanished() -> (WatchState, Instant) {
    let mut watch = WatchState::default();
    let t = Instant::now();
    watch.observe(Some(stamp(1)), t);
    assert_eq!(
        watch.observe(None, t + Duration::from_millis(250)),
        Some(SourceWatchReason::Missing)
    );
    (watch, t)
}

#[test]
fn the_first_stamp_arms_the_watcher_without_an_event() {
    let mut watch = WatchState::default();
    let t = Instant::now();
    assert_eq!(watch.observe(Some(stamp(1)), t), None);
    assert_eq!(
        watch.observe(Some(stamp(1)), t + Duration::from_secs(5)),
        None
    );
}

#[test]
fn an_unchanged_stamp_reports_nothing() {
    let mut watch = WatchState::default();
    let t = Instant::now();
    watch.observe(Some(stamp(1)), t);
    assert_eq!(
        watch.observe(Some(stamp(1)), t + Duration::from_millis(250)),
        None
    );
    assert_eq!(
        watch.observe(Some(stamp(1)), t + Duration::from_secs(3)),
        None
    );
}

#[test]
fn a_change_reports_once_after_it_holds_for_the_settle_window() {
    let mut watch = WatchState::default();
    let t = Instant::now();
    watch.observe(Some(stamp(1)), t);
    assert_eq!(
        watch.observe(Some(stamp(2)), t + Duration::from_millis(250)),
        None
    );
    assert_eq!(
        watch.observe(Some(stamp(2)), t + Duration::from_millis(250) + SETTLE),
        Some(SourceWatchReason::Changed)
    );
    assert_eq!(
        watch.observe(Some(stamp(2)), t + Duration::from_secs(4)),
        None,
        "the same stamp is not reported twice"
    );
}

#[test]
fn a_second_change_inside_the_settle_window_is_not_reported_yet() {
    let mut watch = WatchState::default();
    let t = Instant::now();
    watch.observe(Some(stamp(1)), t);
    watch.observe(Some(stamp(2)), t);
    assert_eq!(
        watch.observe(Some(stamp(3)), t + Duration::from_millis(300)),
        None
    );
    assert_eq!(
        watch.observe(Some(stamp(3)), t + Duration::from_millis(700)),
        None,
        "the settle restarted at the second stamp"
    );
    assert_eq!(
        watch.observe(Some(stamp(3)), t + Duration::from_millis(800)),
        Some(SourceWatchReason::Changed)
    );
}

#[test]
fn a_disappearing_file_reports_missing_once() {
    let (mut watch, t) = vanished();
    assert_eq!(watch.observe(None, t + Duration::from_millis(500)), None);
    assert_eq!(watch.observe(None, t + Duration::from_secs(2)), None);
}

#[test]
fn a_restored_file_reports_changed_after_the_settle_window() {
    let (mut watch, t) = vanished();
    assert_eq!(
        watch.observe(Some(stamp(1)), t + Duration::from_millis(500)),
        None,
        "a restoration settles like any other change"
    );
    assert_eq!(
        watch.observe(Some(stamp(1)), t + Duration::from_millis(500) + SETTLE),
        Some(SourceWatchReason::Changed),
        "the restored stamp matches the old one but must still be read again"
    );
}

#[test]
fn a_length_change_with_the_same_modification_time_counts() {
    let mut watch = WatchState::default();
    let t = Instant::now();
    let older = Stamp {
        modified: Some(SystemTime::UNIX_EPOCH),
        len: 10,
    };
    let newer = Stamp {
        modified: Some(SystemTime::UNIX_EPOCH),
        len: 20,
    };
    watch.observe(Some(older), t);
    assert_eq!(watch.observe(Some(newer), t), None);
    assert_eq!(
        watch.observe(Some(newer), t + SETTLE),
        Some(SourceWatchReason::Changed)
    );
}

#[test]
fn an_unknown_modification_time_still_compares_length() {
    let mut watch = WatchState::default();
    let t = Instant::now();
    watch.observe(
        Some(Stamp {
            modified: None,
            len: 10,
        }),
        t,
    );
    assert_eq!(
        watch.observe(
            Some(Stamp {
                modified: None,
                len: 20
            }),
            t
        ),
        None
    );
    assert_eq!(
        watch.observe(
            Some(Stamp {
                modified: None,
                len: 20
            }),
            t + SETTLE
        ),
        Some(SourceWatchReason::Changed)
    );
}

#[test]
fn a_never_seen_missing_file_reports_nothing() {
    let mut watch = WatchState::default();
    let t = Instant::now();
    assert_eq!(watch.observe(None, t), None);
    assert_eq!(watch.observe(None, t + Duration::from_secs(1)), None);
    assert_eq!(
        watch.observe(Some(stamp(1)), t + Duration::from_secs(2)),
        None,
        "the first successful read arms the watcher"
    );
}
