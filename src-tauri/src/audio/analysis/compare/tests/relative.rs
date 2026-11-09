//! M25.B relative matching: the offsets, the common-span clipping, matrix null columns
//! and the waveform bucket sampling. Kept apart from the M25 checks in `tests.rs`
//! (the 400-line budget).

use super::*;
use crate::audio::analysis::compare::{compare_saved, SavedComparison};
use crate::audio::analysis::{AnalysisResult, MatrixResult, WaveformResult};

#[test]
fn windows_at_different_source_seconds_compare_from_zero() {
    let a = state_with(tone(2.0, 440.0, 1.0));
    let b = state_with(tone(2.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.5, 1.5)),
    );

    assert!(comparison.comparability.aligned);
    // Relative alignment: both sides start at 0 even though the windows do not overlap
    // at the same source seconds — the absolute overlap stays informational.
    let alignment = comparison.comparability.alignment;
    assert!((alignment.a_duration - 1.0).abs() < 1e-6);
    assert!((alignment.b_duration - 1.0).abs() < 1e-6);
    let common = alignment.common.expect("common span");
    assert!((common.start - 0.0).abs() < 1e-6);
    assert!((common.end - 1.0).abs() < 1e-6);
    let overlap = comparison.comparability.overlap.expect("overlap");
    assert!((overlap.start - 0.5).abs() < 1e-6);

    let Some(ComparisonDiff::Series(diff)) = &comparison.diff else {
        panic!("expected a series delta");
    };
    assert!(diff.times.first().is_some_and(|time| *time < 0.1));
    for time in &diff.times {
        assert!(f64::from(*time) >= common.start - 1e-4);
        assert!(f64::from(*time) <= common.end + 1e-4);
    }
    assert!((diff.stats.mean.unwrap() + 6.02).abs() < 0.5);
}

#[test]
fn a_disjoint_relative_window_has_no_time_delta() {
    let a = state_with(tone(2.0, 440.0, 1.0));
    let b = state_with(tone(2.0, 440.0, 1.0));
    // δ pushes B past the end of A, so the shifted windows do not meet.
    let comparison = compare_pair_at(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
        1.5,
    );
    assert!(comparison.comparability.aligned, "the grids still match");
    assert!(comparison.comparability.alignment.common.is_none());
    assert!(comparison.diff.is_none());
}

#[test]
fn the_offset_clips_the_common_span() {
    let a = state_with(tone(2.0, 440.0, 1.0));
    let b = state_with(tone(2.0, 440.0, 0.5));
    let comparison = compare_pair_at(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
        0.25,
    );
    let alignment = comparison.comparability.alignment;
    assert_eq!(alignment.b_offset, 0.25);
    let common = alignment.common.expect("common span");
    assert!((common.start - 0.25).abs() < 1e-6);
    assert!((common.end - 1.0).abs() < 1e-6);
    let Some(ComparisonDiff::Series(diff)) = &comparison.diff else {
        panic!("expected a series delta");
    };
    assert!(diff.times.first().is_some_and(|time| *time >= 0.25 - 1e-4));
}

#[test]
fn the_longer_window_is_clipped_to_the_shorter() {
    let a = state_with(tone(2.0, 440.0, 1.0));
    let b = state_with(tone(2.0, 440.0, 0.5));
    let comparison = compare_pair(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.5)),
        (&b, setup(0.0, 0.8)),
    );
    let common = comparison
        .comparability
        .alignment
        .common
        .expect("common span");
    assert!((common.end - 0.8).abs() < 1e-6);
    let Some(ComparisonDiff::Series(diff)) = &comparison.diff else {
        panic!("expected a series delta");
    };
    assert!(diff
        .times
        .last()
        .is_some_and(|time| f64::from(*time) <= 0.8));
    assert!(diff.times.len() > 20);
}

#[test]
fn a_saved_reference_compares_without_a_second_project() {
    let a = state_with(tone(2.0, 440.0, 1.0));
    let b = state_with(tone(2.0, 440.0, 0.5));
    let live = compare_pair(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.5, 1.5)),
    );
    // Freeze B's side exactly as a save would (unfiltered, δ = 0).
    let snapshot =
        SavedComparison::from_side(AnalyzerId::FrameRms, &live.b, None, 0.0, 1_000, None);

    let saved = compare_saved(
        AnalyzerId::FrameRms,
        SideInput {
            project: Some("A".to_string()),
            state: &a,
            setup: setup(0.0, 1.0),
        },
        &snapshot,
        0.0,
    )
    .expect("saved comparison");

    // B comes from the snapshot: its project name, window and result are restored.
    assert_eq!(saved.b.project.as_deref(), Some("B"));
    assert!((saved.b.setup.start - 0.5).abs() < 1e-6);
    assert!(saved.comparability.aligned);
    assert!(matches!(saved.b.result, AnalysisResult::FrameRms(_)));
    let alignment = saved.comparability.alignment;
    let common = alignment.common.expect("common span");
    assert!((common.end - 1.0).abs() < 1e-6);
    let Some(ComparisonDiff::Series(diff)) = &saved.diff else {
        panic!("expected a series delta");
    };
    assert!(diff.stats.matched > 0);
}

#[test]
fn a_snapshot_fingerprint_ignores_its_timestamp_but_tracks_the_content() {
    let a = state_with(tone(2.0, 440.0, 1.0));
    let b = state_with(tone(2.0, 440.0, 0.5));
    let live = compare_pair(
        AnalyzerId::FrameRms,
        (&a, setup(0.0, 1.0)),
        (&b, setup(0.0, 1.0)),
    );
    let snapshot =
        SavedComparison::from_side(AnalyzerId::FrameRms, &live.b, None, 0.0, 1_000, None);
    let fingerprint = snapshot.fingerprint();

    // Re-saving an unchanged comparison must not look like an edit.
    let mut resaved = snapshot.clone();
    resaved.saved_ms = 2_000;
    assert_eq!(resaved.fingerprint(), fingerprint);

    // A settled change to the reference (or the offset) does.
    let mut moved = snapshot.clone();
    moved.b_offset = 0.05;
    assert_ne!(moved.fingerprint(), fingerprint);
    let mut changed = snapshot.clone();
    changed.reference_name = "other".to_string();
    assert_ne!(changed.fingerprint(), fingerprint);
}

#[test]
fn a_matrix_frame_without_a_counterpart_is_a_null_column() {
    let a_result = AnalysisResult::Mfcc(matrix(vec![0.0, 0.2, 0.4], vec![1.0, 2.0, 3.0]));
    let b_result = AnalysisResult::Mfcc(matrix(
        vec![0.0, 0.01, 0.4, 0.41],
        vec![10.0, 11.0, 40.0, 41.0],
    ));
    let ComparisonDiff::Matrix(delta) = diff_at(&a_result, &b_result, 1.0) else {
        panic!("expected a matrix delta");
    };
    // The middle frame has no B counterpart within tolerance: kept as a null column.
    assert_eq!(delta.columns, vec![true, false, true]);
    assert_eq!(delta.times, vec![0.0, 0.2, 0.4]);
    assert_eq!(delta.values, vec![9.0, 0.0, 37.0]);
    assert_eq!(delta.stats.matched, 2);
}

/// A waveform result whose envelope has `max.len()` buckets over `duration`.
fn waveform(duration: f64, max: Vec<f32>) -> WaveformResult {
    WaveformResult {
        sample_rate: RATE,
        frames: (duration * f64::from(RATE)) as usize,
        duration,
        window_start: 0.0,
        peak: 0.0,
        rms: 0.0,
        peak_db: 0.0,
        rms_db: 0.0,
        min: vec![0.0; max.len()],
        max,
    }
}

/// A synthetic matrix result: one band, frame times and values given directly.
fn matrix(times: Vec<f32>, values: Vec<f32>) -> MatrixResult {
    MatrixResult {
        sample_rate: RATE,
        hop_size: 480,
        frames: times.len(),
        bins: 1,
        duration: 0.5,
        times,
        window_start: 0.0,
        bands: vec![0.0],
        values,
        min_value: 0.0,
        max_value: 0.0,
        ..Default::default()
    }
}

/// Diff two synthetic results over the relative span `0..end` with δ = 0.
fn diff_at(a_result: &AnalysisResult, b_result: &AnalysisResult, end: f64) -> ComparisonDiff {
    let a_setup = setup(0.0, end);
    let b_setup = setup(0.0, end);
    let side_a = align::Side {
        setup: &a_setup,
        result: a_result,
        rate: RATE,
    };
    let side_b = align::Side {
        setup: &b_setup,
        result: b_result,
        rate: RATE,
    };
    diff::diff(&side_a, &side_b, 0.0, Some(Span { start: 0.0, end }))
}

#[test]
fn a_waveform_delta_samples_the_other_envelope_at_a_buckets() {
    let a_result = AnalysisResult::Waveform(waveform(1.0, vec![0.0; 4]));
    let b_result = AnalysisResult::Waveform(waveform(1.0, vec![1.0; 8]));
    let ComparisonDiff::Waveform(delta) = diff_at(&a_result, &b_result, 1.0) else {
        panic!("expected a waveform delta");
    };
    // A's four buckets are sampled against B's finer envelope: exact when windows match.
    assert_eq!(delta.buckets, 4);
    assert_eq!(delta.times, vec![0.0, 0.25, 0.5, 0.75]);
    assert_eq!(delta.values, vec![1.0, 1.0, 1.0, 1.0]);
}

#[test]
fn a_waveform_delta_clips_to_the_common_span() {
    let a_result = AnalysisResult::Waveform(waveform(1.0, vec![0.0; 4]));
    let b_result = AnalysisResult::Waveform(waveform(0.5, vec![0.5; 4]));
    let ComparisonDiff::Waveform(delta) = diff_at(&a_result, &b_result, 0.5) else {
        panic!("expected a waveform delta");
    };
    assert_eq!(delta.buckets, 3, "A's buckets at 0, 0.25 and 0.5 s");
    assert!(delta.times.iter().all(|time| *time <= 0.5));
}

#[test]
fn thinning_a_matrix_delta_keeps_whole_frames() {
    let a_result = AnalysisResult::Mfcc(matrix(vec![0.0, 0.1, 0.2, 0.3], vec![1.0, 2.0, 3.0, 4.0]));
    let b_result = AnalysisResult::Mfcc(matrix(
        vec![0.0, 0.1, 0.2, 0.3],
        vec![10.0, 20.0, 30.0, 40.0],
    ));
    let ComparisonDiff::Matrix(mut delta) = diff_at(&a_result, &b_result, 0.4) else {
        panic!("expected a matrix delta");
    };
    delta.thin(2);
    // Stride 2 keeps frames 0 and 2, with one value each (one band).
    assert_eq!(delta.times, vec![0.0, 0.2]);
    assert_eq!(delta.columns, vec![true, true]);
    assert_eq!(delta.values, vec![9.0, 27.0]);
}

#[test]
fn thinning_a_waveform_delta_keeps_times_and_values_aligned() {
    let a_result = AnalysisResult::Waveform(waveform(1.0, vec![0.0; 8]));
    let b_result = AnalysisResult::Waveform(waveform(1.0, vec![1.0; 8]));
    let ComparisonDiff::Waveform(mut delta) = diff_at(&a_result, &b_result, 1.0) else {
        panic!("expected a waveform delta");
    };
    delta.thin(4);
    assert_eq!(delta.times.len(), 4);
    assert_eq!(delta.values.len(), 4);
    assert_eq!(delta.buckets, 4);
    assert_eq!(delta.source_buckets, Some(8));
}
