//! The per-frame pitch-candidate grid a detector can report alongside its f0 track
//! (M36 deferred payload).

use serde::{Deserialize, Serialize};

/// A frame × semitone-bin grid of pitch-candidate probabilities.
///
/// `values` is **frame-major** (`frames * bins` cells; the frame count is
/// `values.len() / bins`) and aligned with [`PitchResult`](super::PitchResult)'s `times`:
/// row `i` is the distribution the detector scored for that frame, from which the f0
/// estimate (or the unvoiced decision) was chosen. Each row sums to 1 when the frame had
/// any candidate and stays all-zero when it had none, so a row reads the same whether the
/// detector found one strong peak or several competing ones.
///
/// Only pYIN reports candidates; YIN and autocorrelation leave
/// [`PitchResult::candidates`](super::PitchResult) absent.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CandidateGrid {
    pub bins: usize,
    /// Semitone-bin centre frequencies (Hz), one per column.
    pub freqs: Vec<f32>,
    /// Frame-major `frames * bins` candidate probabilities, aligned with
    /// [`PitchResult::times`](super::PitchResult).
    pub values: Vec<f32>,
}
