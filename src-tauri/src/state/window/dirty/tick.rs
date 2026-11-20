//! The settle clock: how a restore becomes the clean point, and why a project reads dirty.
//!
//! Split out of `dirty.rs` to stay inside the source-size budget. See
//! [`super`](crate::state::window::dirty) for the state it drives.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::content::first_difference;
use super::{lock, ProjectDirty};

/// How long restored state may keep settling before it becomes the clean point.
pub const SETTLE_MS: Duration = Duration::from_millis(350);

/// How often the loop looks for a change and for a settled restore.
pub(super) const TICK_MS: u64 = 50;

impl ProjectDirty {
    /// Recompute the signature when an input moved, and end a restore once it is quiet.
    ///
    /// The two transitions log the content that moved (see [`describe`]): a project that
    /// comes up dirty after a load, or goes dirty on its own, is a question the next log
    /// reader must be able to answer — an E2E failure report shows these lines.
    pub(super) fn tick(&self) {
        let inputs = self.inputs.swap(false, Ordering::SeqCst);
        let source = self.source_identity();
        let upgraded = self.upgraded().is_some();
        let mut published = None;
        let mut reason: Option<String> = None;
        // The flag the restore settled on, when this tick locked the baseline.
        let mut settled: Option<bool> = None;
        {
            let mut state = lock(&self.state);
            if inputs || source != state.source {
                state.source = source;
                let next = self.signature();
                if next != state.current {
                    state.current = next;
                    if state.baselining {
                        // The restored state becomes the baseline, and a later settling
                        // change restarts the quiet period (`dirty.ts`'s `armSettle`).
                        // While the restore is still running the clock is not armed at
                        // all: only a change **after** `end_baseline` may end it.
                        state.baseline = state.current.clone();
                        if !state.restoring {
                            state.quiet_since = Some(Instant::now());
                        }
                    } else {
                        let value = state.current != state.baseline || upgraded;
                        if value != state.dirty {
                            state.dirty = value;
                            published = Some(value);
                            if value {
                                reason = Some(describe(&state.baseline, &state.current));
                            }
                        }
                    }
                }
            }
            let quiet = state
                .quiet_since
                .is_some_and(|since| since.elapsed() >= SETTLE_MS);
            if state.baselining && quiet {
                state.baselining = false;
                state.quiet_since = None;
                if upgraded != state.dirty {
                    state.dirty = upgraded;
                    published = Some(upgraded);
                    if upgraded {
                        reason = Some(describe(&state.baseline, &state.current));
                    }
                }
                settled = Some(state.dirty);
            }
        }
        if let Some(dirty) = settled {
            match (dirty, reason.as_deref()) {
                (true, Some(path)) => {
                    log::info!(
                        "project restore settled dirty: differs from the clean point at {path}"
                    )
                }
                (true, None) => log::info!("project restore settled dirty"),
                (false, _) => log::info!("project restore settled clean"),
            }
        }
        if let Some(dirty) = published {
            if dirty && settled.is_none() {
                let path = reason.as_deref().unwrap_or("the source's shape");
                log::info!("project is dirty: differs from the clean point at {path}");
            }
            self.publish(dirty);
        }
    }

    /// Whether a restore is still settling (the tests drive the loop by hand).
    #[cfg(test)]
    pub(super) fn baselining(&self) -> bool {
        lock(&self.state).baselining
    }
}

/// Where a signature's content moved, for the log (e.g. `layout.popouts[0]`).
///
/// The signature wraps the snapshot's content, the source's shape and the compare views;
/// the `snapshot.` prefix is dropped so the path reads like the project file's content.
pub(super) fn describe(baseline: &str, current: &str) -> String {
    let parse = |text: &str| serde_json::from_str::<Value>(text).unwrap_or(Value::Null);
    match first_difference(&parse(baseline), &parse(current)) {
        Some(path) => path.trim_start_matches("snapshot.").to_string(),
        None => "the source's shape".to_string(),
    }
}
