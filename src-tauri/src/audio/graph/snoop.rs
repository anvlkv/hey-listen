//! The `snoop` tap: a compiled net hands the latest samples to the editor.
//!
//! A `snoop` node passes its signal through untouched while fundsp's `SnoopBackend`
//! ships blocks to a `Snoop` frontend. Each compile registers that frontend under
//! `scope/node`, where `scope` is `filter`, `synth`, or a subsystem path
//! (`system:filter/feedback-3`). The graph node polls [`read`] and draws a compact waveform.
//!
//! A rebuild replaces a scope wholesale, so [`clear_scope`] runs before every compile.
//! The registry is process-wide: with several project windows, the last compile of a
//! scope wins (the tap is a monitor, not project state).

use std::collections::HashMap;
use std::sync::Mutex;

use fundsp::prelude64::Snoop;
use serde::Serialize;

/// The latest samples a snoop node sent, oldest first.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnoopView {
    /// Ring-buffer capacity (the most samples [`samples`](Self::samples) can hold).
    pub capacity: usize,
    /// Samples received since the net was compiled.
    pub total: u64,
    /// `points` averaged buckets, oldest first.
    pub samples: Vec<f32>,
}

/// Snoop frontends by `scope/node`. `Snoop` is not `Clone`, so the map owns them.
static SNOOPS: Mutex<Option<HashMap<String, Snoop>>> = Mutex::new(None);

fn key(scope: &str, node: &str) -> String {
    format!("{scope}/{node}")
}

/// Install (or replace) the frontend for one snoop node.
pub(crate) fn register(scope: &str, node: &str, snoop: Snoop) {
    let mut guard = SNOOPS.lock().unwrap_or_else(|poison| poison.into_inner());
    guard
        .get_or_insert_with(HashMap::new)
        .insert(key(scope, node), snoop);
}

/// Forget every snoop under `scope` (before a rebuild registers the new ones).
pub(crate) fn clear_scope(scope: &str) {
    let mut guard = SNOOPS.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some(map) = guard.as_mut() {
        let prefix = format!("{scope}/");
        map.retain(|key, _| !key.starts_with(&prefix));
    }
}

/// The latest `points` samples a snoop node saw, or an empty view if it has not run.
pub fn read(scope: &str, node: &str, points: usize) -> SnoopView {
    let mut guard = SNOOPS.lock().unwrap_or_else(|poison| poison.into_inner());
    let Some(snoop) = guard
        .as_mut()
        .and_then(|map| map.get_mut(&key(scope, node)))
    else {
        return SnoopView::default();
    };
    snoop.update();
    let capacity = snoop.capacity();
    let total = snoop.total();
    let points = points.clamp(8, 256).min(capacity);
    let mut samples = Vec::with_capacity(points);
    // `at(0)` is the newest sample; walk the buffer oldest → newest, bucketed so the
    // drawn shape keeps peaks instead of averaging them away.
    for bucket in 0..points {
        let start = bucket * capacity / points;
        let end = ((bucket + 1) * capacity / points).max(start + 1);
        let mut peak = 0.0f32;
        for index in start..end {
            peak = peak.max(snoop.at(capacity - 1 - index).abs());
        }
        samples.push(peak.min(1.0));
    }
    SnoopView {
        capacity,
        total,
        samples,
    }
}
