//! The dirty accessors on [`WindowState`], and the `isEmptyProject` query a discard guard
//! asks before prompting.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager};

use crate::state::WindowRegistry;

use super::super::WindowState;
use super::content::graphs_pristine;
use super::GRAPH_PRISTINE_KEY;

impl WindowState {
    /// Point this project's dirty tracker at `app`/`label` (idempotent).
    pub fn arm_dirty(&self, app: AppHandle, label: &str) {
        let root = app.state::<WindowRegistry>().root_label(label);
        self.dirty.arm(app, root);
    }

    pub fn dirty(&self) -> bool {
        self.dirty.dirty()
    }

    /// Recompute and answer (an unsaved-work guard must not read a stale flag).
    pub fn dirty_now(&self) -> bool {
        self.dirty.dirty_now()
    }

    pub fn mark_clean(&self) {
        self.dirty.mark_clean();
    }

    pub fn begin_baseline(&self) {
        self.dirty.begin_baseline();
    }

    pub fn end_baseline(&self) {
        self.dirty.end_baseline();
    }

    pub fn set_upgraded_from(&self, from: Option<u32>) {
        self.dirty.set_upgraded_from(from);
    }

    /// Whether the project has nothing worth protecting: no source PCM, no recording, no
    /// annotations, and both graph editors still in their seeded shape. Opening a tab
    /// marks such a project dirty (the layout is project content), but a discard prompt
    /// would be noise — there is no work to lose yet.
    ///
    /// The graph check is the frontend's `graphPristine` result (pushed as
    /// [`GRAPH_PRISTINE_KEY`]): deciding it here would restate the node-kind defaults.
    pub fn is_empty_project(&self) -> bool {
        let no_source = self
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .is_none();
        let not_recording = !self.audio.recording.load(Ordering::Relaxed);
        let no_annotations = self
            .history
            .read_latest(|snapshot| snapshot.annotations.is_empty());
        let pristine = graphs_pristine(
            self.ui
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .get(GRAPH_PRISTINE_KEY),
        );
        no_source && not_recording && no_annotations && pristine
    }
}
