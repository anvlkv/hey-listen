//! The `loudness` result summary (M27), split out of [`super::families`] for the
//! source-size budget.

use super::SummaryBuilder;
use crate::audio::analysis::psychoacoustics::loudness::sone_to_phon;
use crate::audio::analysis::LoudnessResult;

/// The sone N5 / mean / max, the N5 in phons, and the calibration state.
pub(super) fn loudness(b: &mut SummaryBuilder, r: &LoudnessResult) {
    b.count("frames", "frames", r.times.len());
    let mut present: Vec<f64> = r
        .loudness_sone
        .iter()
        .flatten()
        .filter(|value| value.is_finite())
        .map(|value| f64::from(*value))
        .collect();
    let max = present.iter().copied().reduce(f64::max).unwrap_or(0.0);
    let mean = if present.is_empty() {
        0.0
    } else {
        present.iter().sum::<f64>() / present.len() as f64
    };
    // N5 is the loudness **exceeded 5 % of the time** — the upper 5 % tail of the
    // frame distribution, not a level exceeded 95 % of the time. With the frames
    // sorted descending, nearest-rank puts it at index ⌊0.05 n⌋ (clamped to the
    // last frame): for n = 20 that is one frame below the maximum, i.e. exactly the
    // loudness one frame (5 %) exceeds.
    present.sort_by(|a, b| b.total_cmp(a));
    let index = if present.is_empty() {
        0
    } else {
        ((0.05 * present.len() as f64).floor() as usize).min(present.len() - 1)
    };
    let n5 = present.get(index).copied().unwrap_or(0.0);
    b.push("n5Sone", "N5", n5, Some("sone"));
    b.push("meanSone", "mean", mean, Some("sone"));
    b.push("maxSone", "max", max, Some("sone"));
    b.push(
        "n5Phon",
        "N5 level",
        f64::from(sone_to_phon(n5 as f32)),
        Some("phon"),
    );
    b.push(
        "calibrated",
        "calibrated",
        if r.calibrated { 1.0 } else { 0.0 },
        None,
    );
    b.push(
        "calibrationDbSpl",
        "calibration",
        f64::from(r.calibration_db_spl),
        Some("dB SPL"),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analyzers::AnalyzerId;

    fn result(sones: &[Option<f32>]) -> LoudnessResult {
        LoudnessResult {
            sample_rate: 48_000,
            hop_size: 512,
            window_start: 0.0,
            times: (0..sones.len())
                .map(|frame| frame as f32 * 512.0 / 48_000.0)
                .collect(),
            loudness_sone: sones.to_vec(),
            loudness_phon: sones.to_vec(),
            calibrated: true,
            calibration_db_spl: 94.0,
        }
    }

    fn n5(sones: &[Option<f32>]) -> f64 {
        let mut builder = SummaryBuilder::new(AnalyzerId::Loudness, "Loudness");
        loudness(&mut builder, &result(sones));
        builder
            .finish()
            .items
            .into_iter()
            .find(|item| item.key == "n5Sone")
            .expect("N5 item")
            .value
    }

    #[test]
    fn n5_is_the_loudness_exceeded_five_percent_of_the_time() {
        // Twenty frames at 1..=20 sone: one frame (the 20) is exceeded by 5 % of
        // them, so N5 is the next value down, 19 sone.
        let ascending: Vec<Option<f32>> = (1..=20).map(|value| Some(value as f32)).collect();
        assert_eq!(n5(&ascending), 19.0);
        // A flat series has no tail: every frame is N5.
        assert_eq!(n5(&[Some(3.0); 20]), 3.0);
        // Gaps are not frames; two present values put N5 at the maximum.
        assert_eq!(n5(&[None, Some(1.0), Some(2.0)]), 2.0);
    }
}
