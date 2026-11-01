//! Headless comparisons (M25.D): diff the session's project against another
//! `.heyl` file, or against the project's own saved snapshot.
//!
//! The app compares two **live** windows; a headless session has one project, so the
//! reference is a project file read through the same loader the batch CLI uses
//! ([`crate::project::side::load_side`]). Each side keeps its own saved window,
//! shared params, options and filter, so the delta matches an app/CLI comparison.
//!
//! The last successful comparison is stored in the session's window state — the same
//! per-tool store the app fills — so `save_project` writes it as the project's
//! `COMPARE` section and the app restores it as a compare tab.

use serde_json::Value;

use crate::audio::analysis::compare::{self, CompareSetup, Comparison, SavedComparison, SideInput};
use crate::audio::analysis::{Axis, Shape};
use crate::project::side::load_side;

use super::args::{self, analyzer};
use super::HeadlessSession;

/// The reference side a headless call resolved to (M25.D).
enum Reference {
    /// The session's stored snapshot (`saved: true`).
    Saved(Box<SavedComparison>),
    /// A project file path (`with`).
    Live(String),
}

impl HeadlessSession {
    /// `compare_analysis` in a headless session.
    ///
    /// Arguments mirror the app tool, except the reference: `with` is a **project
    /// path** (`.heyl`), and `saved: true` reuses the session's stored snapshot.
    /// `params` / `options` / `start` / `end` patch **A** (the session), exactly as
    /// `run_analysis` does; B always runs with its saved setup.
    pub(super) fn compare_analysis(&mut self, args: &Value) -> Result<Value, String> {
        let tool = analyzer(args, "tool")?;
        let saved = args.get("saved").and_then(Value::as_bool).unwrap_or(false);
        let transient = args::transient(args);

        // A's params/options/window follow `run_analysis`'s persistence rule: a patch
        // persists unless the call is transient.
        let params = args::effective_params(&mut self.params, args, transient)?;
        let options = args::effective_options(&mut self.options, tool, args, transient)?;
        let ((start, end), has_window) = args::effective_window(self.window, args, self.duration());
        if has_window && !transient {
            self.window = (start, end);
        }

        let b_offset = args.get("bOffset").and_then(Value::as_f64);
        let (shape, max_points, axis) = args::output_mode(args)?;

        // Resolve and validate the reference side first, so a malformed request reports
        // the real problem even before A has a source.
        let reference = if saved {
            Reference::Saved(Box::new(self.state.saved_comparison(tool).ok_or_else(
                || {
                    format!(
                        "no saved comparison for '{tool}' — call `compare_analysis` with a \
                     `with` project path first"
                    )
                },
            )?))
        } else {
            Reference::Live(
                args.get("with")
                    .and_then(Value::as_str)
                    .filter(|path| !path.is_empty())
                    .ok_or_else(|| {
                        "`with` (the reference project's `.heyl` path) is required unless \
                         `saved: true`"
                            .to_string()
                    })?
                    .to_string(),
            )
        };

        if self.source_summary().is_null() {
            return Err(
                "no source loaded in this project — open a source (`open_audio_file` / \
                 `open_project`) first"
                    .to_string(),
            );
        }

        let a = SideInput {
            project: self.project_label(),
            state: &self.state,
            setup: CompareSetup {
                start,
                end,
                params,
                options,
            },
        };

        match reference {
            Reference::Saved(stored) => {
                let b_offset = b_offset.unwrap_or(stored.b_offset);
                let comparison = compare::compare_saved(tool, a, &stored, b_offset)
                    .map_err(|err| err.to_string())?;
                // The stored result is untouched; only the display offset may have moved.
                let mut snapshot = stored;
                snapshot.b_offset = b_offset;
                self.state.store_saved_comparison(snapshot.as_ref().clone());
                Ok(comparison_value(
                    &comparison,
                    shape,
                    max_points,
                    axis,
                    &snapshot,
                ))
            }
            Reference::Live(path) => {
                let b_offset = b_offset.unwrap_or(0.0);
                let side = load_side(&path, None)?;
                let comparison = compare::compare(
                    tool,
                    a,
                    SideInput {
                        project: Some(side.name.clone()),
                        state: &side.state,
                        setup: side.setup_for(tool),
                    },
                    b_offset,
                )
                .map_err(|err| err.to_string())?;
                let snapshot = SavedComparison::from_side(
                    tool,
                    &comparison.b,
                    compare::filter_fingerprint(&side.state),
                    b_offset,
                    crate::recent::now_ms(),
                );
                self.state.store_saved_comparison(snapshot.clone());
                Ok(comparison_value(
                    &comparison,
                    shape,
                    max_points,
                    axis,
                    &snapshot,
                ))
            }
        }
    }

    /// The session's project label for a comparison side, when it has one.
    fn project_label(&self) -> Option<String> {
        self.project_name
            .clone()
            .filter(|name| !name.is_empty())
            .or_else(|| Some(self.name.clone()).filter(|name| !name.is_empty()))
    }
}

/// The wire value for a comparison, plus the snapshot's fingerprint.
fn comparison_value(
    comparison: &Comparison,
    shape: Shape,
    max_points: Option<usize>,
    axis: Axis,
    snapshot: &SavedComparison,
) -> Value {
    let mut value = comparison.to_value(shape, max_points, axis);
    value["savedFingerprint"] = Value::String(snapshot.fingerprint());
    value
}
