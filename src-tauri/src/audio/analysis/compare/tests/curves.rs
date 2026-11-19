//! The result shapes whose compare delta is not a plain `SeriesResult` / `SpectrumResult`:
//! masking diffs its **SMR** curve, sone loudness its `loudness_sone` track. Both used to
//! fall through to the scalar catch-all, so the view had nothing to draw.

use super::*;

#[test]
fn a_masking_comparison_diffs_the_smr_curve() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 220.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::Masking,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );

    let Some(ComparisonDiff::Spectrum(diff)) = &comparison.diff else {
        panic!("masking diffs a spectrum delta");
    };
    assert!(
        diff.header.summary.contains("SMR"),
        "{}",
        diff.header.summary
    );
    assert_eq!(diff.freqs.len(), diff.values.len());
    assert!(diff.stats.matched > 0);
}

#[test]
fn a_sone_loudness_comparison_diffs_the_sone_track() {
    let a = state_with(tone(1.0, 440.0, 1.0));
    let b = state_with(tone(1.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::Loudness,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );

    let Some(ComparisonDiff::Series(diff)) = &comparison.diff else {
        panic!("sone loudness diffs a series delta");
    };
    assert!(diff.stats.matched > 0);
    // Halving the amplitude is quieter, so every sone delta is B − A ≤ 0.
    let mean = diff.stats.mean.expect("a mean over the matched frames");
    assert!(mean < 0.0, "mean sone delta {mean}");
    assert!(diff.times.windows(2).all(|pair| pair[1] > pair[0]));
}
