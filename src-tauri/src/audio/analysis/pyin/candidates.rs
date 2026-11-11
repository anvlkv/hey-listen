//! The pYIN candidate grid and its octave-ambiguity flag (M36 deferred payload).
//!
//! `detect` accumulates one Beta-weighted score per (frame, semitone bin) and then runs
//! a Viterbi pass to pick a single bin — or the unvoiced state — per frame. The scores
//! are the evidence behind that choice, so they are reported: a caller can see a clean
//! peak, two competing candidates, or a frame with no candidate at all, instead of only
//! the winning bin.

use super::{bin_to_freq, N_BINS};
use crate::audio::analysis::CandidateGrid;

/// The nearest semitone distance that can be read as an octave. A little slack either
/// side covers bin quantization and inharmonic alternatives.
const OCTAVE_MIN_SEMITONES: usize = 10;
const OCTAVE_MAX_SEMITONES: usize = 14;
/// An octave-away alternative this strong, relative to the chosen bin, is "comparable":
/// the estimate is a coin flip between two octave-related candidates.
const COMPARABLE_RATIO: f64 = 0.5;

/// Normalize the per-frame Beta-weighted bin scores into probabilities.
///
/// Each threshold (`0.05 … 0.95`) contributes its Beta(2, 18) weight to the bin its lag
/// minimum lands in, so a row sums to that frame's accumulated weight —
/// `voiced_prob[frame]`. Dividing the row by that sum makes it a distribution over the
/// semitone bins: a frame with any candidate sums to 1, a frame with none keeps an
/// all-zero row (its mass is in the Viterbi unvoiced state). Every entry is a part of the
/// same non-negative sum, so the normalized values lie in `[0, 1]`.
///
/// Rows stay frame-major and in the same order as the returned frames.
pub(super) fn grid(obs_voiced: &[Vec<f64>], voiced_prob: &[f64]) -> CandidateGrid {
    let mut values = Vec::with_capacity(obs_voiced.len() * N_BINS);
    for (row, &total) in obs_voiced.iter().zip(voiced_prob) {
        values.extend(row.iter().map(|&weight| {
            if total > 0.0 {
                (weight / total) as f32
            } else {
                0.0
            }
        }));
    }
    CandidateGrid {
        bins: N_BINS,
        freqs: (0..N_BINS).map(bin_to_freq).collect(),
        values,
    }
}

/// Mark each frame whose chosen bin has a comparable candidate 10–14 semitones away.
///
/// For frame `i` the chosen bin is `path[i]` and its probability is
/// `grid.values[i * bins + path[i]]`. The alternative is the strongest probability in
/// the `chosen ± 14` bin window, restricted to distances of 10–14 semitones (an octave,
/// with quantization slack). The frame is ambiguous when that probability is at least
/// half the chosen bin's — both candidates then explain the observation almost equally
/// well, so the reported octave is not a clear winner. An unvoiced frame (the state is
/// outside the bin range) or a chosen bin with no candidate mass is never ambiguous.
pub(super) fn octave_ambiguous(grid: &CandidateGrid, path: &[usize]) -> Vec<bool> {
    let bins = grid.bins;
    let last = bins.saturating_sub(1);
    path.iter()
        .enumerate()
        .map(|(frame, &chosen)| {
            let Some(row) = grid.values.get(frame * bins..(frame + 1) * bins) else {
                return false;
            };
            let Some(&probability) = row.get(chosen) else {
                return false;
            };
            let probability = f64::from(probability);
            if probability <= 0.0 {
                return false;
            }
            let low = chosen.saturating_sub(OCTAVE_MAX_SEMITONES);
            let high = (chosen + OCTAVE_MAX_SEMITONES).min(last);
            let alternative = row[low..=high]
                .iter()
                .enumerate()
                .filter(|&(offset, _)| {
                    let distance = (low + offset).abs_diff(chosen);
                    (OCTAVE_MIN_SEMITONES..=OCTAVE_MAX_SEMITONES).contains(&distance)
                })
                .map(|(_, &value)| f64::from(value))
                .fold(0.0, f64::max);
            alternative >= COMPARABLE_RATIO * probability
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{grid, octave_ambiguous};
    use crate::audio::analysis::CandidateGrid;

    #[test]
    fn the_grid_normalizes_each_frame_by_its_accumulated_weight() {
        let mut scored = vec![0.0; 108];
        scored[1] = 2.0;
        scored[2] = 6.0;
        let grid = grid(&[scored, vec![0.0; 108]], &[8.0, 0.0]);
        // The semitone axis is the detector's full grid, one frequency per column.
        assert_eq!(grid.bins, 108);
        assert_eq!(grid.freqs.len(), grid.bins);
        assert_eq!(grid.values.len(), 2 * 108);
        // A frame with candidates is a distribution; a frame without one is all zeros.
        assert!((grid.values[1] - 0.25).abs() < 1e-6);
        assert!((grid.values[2] - 0.75).abs() < 1e-6);
        assert!(grid.values[108..].iter().all(|&value| value == 0.0));
        assert!(grid
            .values
            .iter()
            .all(|&value| (0.0..=1.0).contains(&value)));
    }

    /// A semitone-step grid; the column frequencies are not read by the ambiguity rule.
    fn semitone_grid(row: &[f32]) -> CandidateGrid {
        CandidateGrid {
            bins: row.len(),
            freqs: vec![440.0; row.len()],
            values: row.to_vec(),
        }
    }

    #[test]
    fn a_comparable_octave_candidate_marks_the_frame_ambiguous() {
        // Chosen bin 12: bin 0 sits exactly one octave (12 semitones) below it.
        let mut row = vec![0.0; 25];
        row[0] = 0.4;
        row[12] = 0.6;
        assert_eq!(octave_ambiguous(&semitone_grid(&row), &[12]), vec![true]);
        // A weak alternative is not comparable.
        row[0] = 0.1;
        assert_eq!(octave_ambiguous(&semitone_grid(&row), &[12]), vec![false]);
        // The unvoiced state lies past the last bin, and a zero-mass choice is no
        // evidence either way.
        assert_eq!(octave_ambiguous(&semitone_grid(&row), &[25]), vec![false]);
        assert_eq!(
            octave_ambiguous(&semitone_grid(&[0.0; 25]), &[12]),
            vec![false]
        );

        // The rule is `>=`: exactly half the chosen probability is still ambiguous.
        let mut boundary = vec![0.0; 25];
        boundary[0] = 0.25;
        boundary[12] = 0.5;
        assert_eq!(
            octave_ambiguous(&semitone_grid(&boundary), &[12]),
            vec![true]
        );

        // The comparison window is 10–14 semitones: 10 and 14 qualify, 9 and 15 do not.
        let mut slack = vec![0.0; 40];
        slack[20] = 0.5;
        slack[10] = 0.25; // 10 below
        assert_eq!(octave_ambiguous(&semitone_grid(&slack), &[20]), vec![true]);
        slack[10] = 0.0;
        slack[6] = 0.25; // 14 below
        assert_eq!(octave_ambiguous(&semitone_grid(&slack), &[20]), vec![true]);
        slack[6] = 0.0;
        slack[11] = 0.25; // 9 below
        assert_eq!(octave_ambiguous(&semitone_grid(&slack), &[20]), vec![false]);
        slack[11] = 0.0;
        slack[5] = 0.25; // 15 below
        assert_eq!(octave_ambiguous(&semitone_grid(&slack), &[20]), vec![false]);
    }
}
