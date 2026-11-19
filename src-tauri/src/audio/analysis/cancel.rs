//! Mid-run cancellation for the analysis engine (D-21).
//!
//! A single `oxiaudio` bulk call cannot be interrupted. The engine therefore checks a
//! token between the chunks **it** owns — the window slice, the conditioning stages,
//! the frame loops of the shared helpers, and on either side of each tool call — so a
//! superseded request stops at the next check instead of running to completion.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::AnalysisError;

/// A cancellable run's token.
///
/// Cloning shares the same flag (the `Arc`), which is what the window's registry stores
/// while the command keeps its own handle. `never()` is the inert token the headless
/// dispatcher, the CLI, exports and the tests pass: nothing holds a clone, so it is
/// never flipped.
#[derive(Debug, Clone)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    /// A fresh, uncancelled token.
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    /// A token for callers that never cancel.
    pub fn never() -> Self {
        Self::new()
    }

    /// Ask the run to stop at its next check.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    /// Whether a stop has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    /// `Err(AnalysisError::Cancelled)` once a stop was requested, `Ok(())` otherwise.
    pub fn check(&self) -> Result<(), AnalysisError> {
        if self.is_cancelled() {
            Err(AnalysisError::Cancelled)
        } else {
            Ok(())
        }
    }
}

impl Default for Cancel {
    fn default() -> Self {
        Self::new()
    }
}

/// One project window's in-flight analysis runs: `request_id` → token.
///
/// The map is private: callers register, flip and forget a token through
/// [`Cancels::begin`], [`Cancels::cancel`] and [`Cancels::finish`]. The lock is a leaf —
/// it is never held while an analysis runs, so a cancel never queues behind the run it
/// is trying to stop.
#[derive(Default)]
pub struct Cancels(Mutex<HashMap<u64, Cancel>>);

impl Cancels {
    /// Register a token for `request_id` and hand back a clone for the run.
    ///
    /// `0` means "no cancellation requested" by the caller: nothing is registered and
    /// the returned token is inert, so the frontend does not have to send an id.
    pub fn begin(&self, request_id: u64) -> Cancel {
        let cancel = Cancel::new();
        if request_id != 0 {
            self.0
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .insert(request_id, cancel.clone());
        }
        cancel
    }

    /// Flip the token of a run still in flight; an unknown (or finished) id is a no-op,
    /// so a late cancel from the frontend is harmless.
    pub fn cancel(&self, request_id: u64) {
        let runs = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        if let Some(cancel) = runs.get(&request_id) {
            cancel.cancel();
        }
    }

    /// Forget a finished run (success, error, or cancellation) so the map cannot leak.
    pub fn finish(&self, request_id: u64) {
        self.0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(&request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn begin_cancel_finish_share_one_token() {
        let runs = Cancels::default();
        let token = runs.begin(7);
        assert!(!token.is_cancelled());

        runs.cancel(7);
        assert!(matches!(token.check(), Err(AnalysisError::Cancelled)));

        runs.finish(7);
        assert!(runs.0.lock().unwrap().is_empty(), "the entry is dropped");
        // A late cancel after the run ended changes nothing and cannot resurrect it.
        runs.cancel(7);
        assert!(runs.0.lock().unwrap().is_empty());
    }

    #[test]
    fn request_zero_is_never_registered() {
        let runs = Cancels::default();
        let token = runs.begin(0);
        runs.cancel(0);
        assert!(!token.is_cancelled());
        assert!(
            runs.0.lock().unwrap().is_empty(),
            "0 means no cancellation requested"
        );
    }
}
