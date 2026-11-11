//! Tests for the single result shaper (`shape_result` / `compact` / decimation).

use serde_json::json;

use crate::audio::analysis::fixtures::{
    calibrated_series, loudness, masking, matrix, notes, pitch, rhythm, series, series_with_rates,
    spectrum,
};
use crate::audio::analysis::{shape_result_with, AnalysisResult, Axis, MatrixResult, Shape};

/// The default `Axis::Array` spelling for the compact/full assertions below.
fn shape(result: &AnalysisResult, shape: Shape, max: Option<usize>) -> Option<serde_json::Value> {
    shape_result_with(result, shape, max, Axis::Array)
}

#[test]
fn compact_spectrum_keeps_the_peak_and_collapses_the_arrays() {
    let value = shape(&AnalysisResult::Spectrum(spectrum()), Shape::Compact, None)
        .expect("compact returns a result");
    // Scalars (and the peak) survive untouched.
    assert_eq!(value["tool"], "spectrum");
    assert_eq!(value["peakHz"], 200.0);
    assert_eq!(value["fftSize"], 2_048);
    // Arrays become stats with the peak bin locatable.
    assert_eq!(value["magDb"]["length"], 3);
    assert_eq!(value["magDb"]["max"], -6.0);
    assert_eq!(value["magDb"]["argmax"], 1);
    assert_eq!(value["freqs"]["max"], 300.0);
}

#[test]
fn compact_matrix_keeps_dimensions_and_the_peak_location() {
    let value = shape(&AnalysisResult::Mfcc(matrix()), Shape::Compact, None)
        .expect("compact returns a result");
    assert_eq!(value["frames"], 2);
    assert_eq!(value["bins"], 2);
    // The strongest cell is frame 1, band 1 (flat index 3).
    assert_eq!(value["peakFrame"], 1);
    assert_eq!(value["peakBand"], 1);
    assert_eq!(value["peakValue"], 4.0);
    assert!((value["peakTime"].as_f64().unwrap() - 0.1).abs() < 1e-4);
    assert_eq!(value["values"]["length"], 4);
    assert_eq!(value["times"]["length"], 2);
    assert!((value["times"]["end"].as_f64().unwrap() - 0.1).abs() < 1e-4);
}

#[test]
fn compact_series_counts_gaps_and_reports_the_hop() {
    let value = shape(
        &AnalysisResult::SpectralCentroid(series()),
        Shape::Compact,
        None,
    )
    .expect("compact returns a result");
    assert_eq!(value["values"]["length"], 4);
    assert_eq!(value["values"]["nulls"], 1);
    assert_eq!(value["values"]["argmax"], 2);
    assert_eq!(value["times"]["start"], 0.0);
    // argmax 2 + start + hop = 0.02 s without a full array.
    assert!((value["times"]["hop"].as_f64().unwrap() - 0.01).abs() < 1e-9);
}

#[test]
fn compact_rhythm_previews_the_event_lists() {
    let value = shape(&AnalysisResult::Tempo(rhythm()), Shape::Compact, None)
        .expect("compact returns a result");
    // BPM/confidence stay scalars; the envelope becomes stats.
    assert_eq!(value["bpm"], 120.0);
    assert_eq!(value["onsetStrength"]["length"], 3);
    // Event lists keep their first few records.
    assert_eq!(value["beatTimes"]["length"], 2);
    assert_eq!(value["beatTimes"]["truncated"], false);
    assert_eq!(value["beatTimes"]["preview"][1], 0.5);
}

#[test]
fn compact_notes_previews_the_records_and_keeps_all_bounds() {
    let value = shape(&AnalysisResult::NoteMetrics(notes()), Shape::Compact, None)
        .expect("compact returns a result");
    assert_eq!(value["noteCount"], 1);
    assert_eq!(value["notes"]["length"], 1);
    assert_eq!(value["notes"]["truncated"], false);
    assert_eq!(value["notes"]["preview"][0]["rmsDb"], -18.0);
    assert_eq!(value["gaps"]["length"], 1);
    // The spans are cheap and unbounded, so an agent can segment without a full result.
    let bounds = value["bounds"].as_array().expect("bounds");
    assert_eq!(bounds.len(), 1);
    assert!(bounds[0]["startSecs"].as_f64().is_some());
    assert!(bounds[0]["endSecs"].as_f64().is_some());
}

#[test]
fn summary_shape_returns_no_result() {
    assert!(shape(&AnalysisResult::Spectrum(spectrum()), Shape::Summary, None).is_none());
}

#[test]
fn full_shape_is_raw_and_decimates_a_series_by_keeping_first_and_last() {
    let full = shape(&AnalysisResult::Spectrum(spectrum()), Shape::Full, None)
        .expect("full returns a result");
    assert_eq!(full["magDb"].as_array().unwrap().len(), 3);

    let decimated = shape(
        &AnalysisResult::SpectralCentroid(series()),
        Shape::Full,
        Some(2),
    )
    .expect("full returns a result");
    // Times and values move together, so argmax still maps onto the right frame.
    assert_eq!(decimated["values"], json!([1.0, 2.0]));
    let times = decimated["times"].as_array().unwrap();
    assert_eq!(times[0], 0.0);
    assert!((times[1].as_f64().unwrap() - 0.03).abs() < 1e-6);
}

#[test]
fn decimation_thins_a_matrix_by_frames_and_keeps_the_grid_valid() {
    let value = shape(&AnalysisResult::Mfcc(matrix_4x2()), Shape::Full, Some(2))
        .expect("full returns a result");
    assert_eq!(value["frames"], 2);
    assert_eq!(value["sourceFrames"], 4);
    assert_eq!(value["bins"], 2);
    assert_eq!(value["values"], json!([1.0, 2.0, 5.0, 6.0]));
    let times = value["times"].as_array().unwrap();
    assert_eq!(times[0], 0.0);
    assert!((times[1].as_f64().unwrap() - 0.2).abs() < 1e-6);
}

#[test]
fn decimation_never_drops_event_records() {
    let mut rhythm = rhythm();
    rhythm.onset_times = (0..5).map(|index| index as f32).collect();
    rhythm.beat_times = (0..5).map(|index| index as f32).collect();
    let value =
        shape(&AnalysisResult::Tempo(rhythm), Shape::Full, Some(2)).expect("full returns a result");
    // The envelope thins, but the detected events are all still there.
    assert_eq!(value["onsetStrength"].as_array().unwrap().len(), 2);
    assert_eq!(value["onsetTimes"].as_array().unwrap().len(), 5);
    assert_eq!(value["beatTimes"].as_array().unwrap().len(), 5);
}

#[test]
fn compact_axis_replaces_a_uniform_time_array_with_start_hop_length() {
    let value = shape_result_with(
        &AnalysisResult::SpectralCentroid(series()),
        Shape::Full,
        None,
        Axis::Compact,
    )
    .expect("full returns a result");
    assert_eq!(value["times"]["start"], 0.0);
    assert!((value["times"]["hop"].as_f64().unwrap() - 0.01).abs() < 1e-9);
    assert_eq!(value["times"]["length"], 4);
    // The values are untouched.
    assert_eq!(value["values"].as_array().unwrap().len(), 4);
}

#[test]
fn compact_axis_keeps_an_overlap_add_edge_frame() {
    // Every hop-based series ends with one short frame; it must not defeat compaction
    // and must stay reconstructible through `lastHop`.
    let mut result = series();
    result.times = vec![0.0, 0.01, 0.02, 0.025];
    let value = shape_result_with(
        &AnalysisResult::SpectralCentroid(result),
        Shape::Full,
        None,
        Axis::Compact,
    )
    .expect("full returns a result");
    assert_eq!(value["times"]["length"], 4);
    assert!((value["times"]["hop"].as_f64().unwrap() - 0.01).abs() < 1e-9);
    assert!((value["times"]["lastHop"].as_f64().unwrap() - 0.005).abs() < 1e-9);
    assert!((value["times"]["end"].as_f64().unwrap() - 0.025).abs() < 1e-6);
    assert!(value["times"].get("firstHop").is_none());
}

#[test]
fn compact_axis_leaves_a_non_uniform_interior_as_an_array() {
    let mut result = series();
    result.times = vec![0.0, 0.01, 0.03, 0.04];
    let value = shape_result_with(
        &AnalysisResult::SpectralCentroid(result),
        Shape::Full,
        None,
        Axis::Compact,
    )
    .expect("full returns a result");
    assert!(value["times"].is_array());
}

#[test]
fn compact_contribution_grid_keeps_its_axes_and_collapses_the_cells() {
    // The M36 drill-down grid is compacted with its series: the band centres (one per
    // column) stay readable, the cell array becomes stats, and the frame axis is an
    // extent — a compact result never carries a full `frames × bins` array.
    let value = shape(
        &AnalysisResult::Sharpness(calibrated_series()),
        Shape::Compact,
        None,
    )
    .expect("compact returns a result");
    assert_eq!(value["contribution"]["frames"], 4);
    assert_eq!(value["contribution"]["bins"], 2);
    assert_eq!(value["contribution"]["bands"], json!([250.0, 1_000.0]));
    assert_eq!(value["contribution"]["values"]["length"], 8);
    assert_eq!(value["contribution"]["label"], "band contribution");
    assert_eq!(value["contribution"]["times"]["length"], 4);
}

#[test]
fn compact_rate_matrix_keeps_both_axes_and_collapses_the_cells() {
    // The band × rate matrix has two axes of its own, so both stay readable while the
    // cell array becomes stats — a compact result never carries a full
    // `frames × bands × rates` array.
    let value = shape(
        &AnalysisResult::Roughness(series_with_rates()),
        Shape::Compact,
        None,
    )
    .expect("compact returns a result");
    let rates = &value["rateContribution"];
    assert_eq!(rates["frames"], 4);
    assert_eq!(rates["bands"], 2);
    assert_eq!(rates["rates"], 3);
    assert_eq!(rates["bandHz"], json!([250.0, 1_000.0]));
    assert_eq!(rates["rateHz"], json!([4.0, 16.0, 70.0]));
    assert_eq!(rates["values"]["length"], 24);
}

#[test]
fn decimation_thins_the_contribution_grid_with_its_frames() {
    let value = shape(
        &AnalysisResult::Roughness(series_with_rates()),
        Shape::Full,
        Some(2),
    )
    .expect("full returns a result");
    assert_eq!(value["contribution"]["frames"], 2);
    assert_eq!(value["contribution"]["sourceFrames"], 4);
    assert_eq!(value["contribution"]["bins"], 2);
    assert_eq!(value["contribution"]["values"].as_array().unwrap().len(), 4);
    assert_eq!(value["contribution"]["times"].as_array().unwrap().len(), 2);
    assert_eq!(value["values"].as_array().unwrap().len(), 2);
    // The rate matrix thins by whole frames too, keeping its `bands * rates` stride
    // (2 × 3), so every kept frame still owns a complete band × rate slice.
    let rates = &value["rateContribution"];
    assert_eq!(rates["frames"], 2);
    assert_eq!(rates["sourceFrames"], 4);
    assert_eq!(rates["bands"], 2);
    assert_eq!(rates["rates"], 3);
    assert_eq!(rates["values"].as_array().unwrap().len(), 12);
}

#[test]
fn compact_masking_previews_the_maskers() {
    let value = shape(&AnalysisResult::Masking(masking()), Shape::Compact, None)
        .expect("compact returns a result");
    assert_eq!(value["smrDb"]["length"], 3);
    assert_eq!(value["maskers"]["length"], 2);
    assert_eq!(value["maskers"]["truncated"], false);
    assert_eq!(value["maskers"]["preview"][0]["tonal"], true);
}

#[test]
fn compact_pitch_collapses_the_candidate_grid() {
    let value = shape(&AnalysisResult::PitchPyin(pitch()), Shape::Compact, None)
        .expect("compact returns a result");
    // The column axis (one frequency per bin) stays readable; the cells become stats.
    assert_eq!(value["candidates"]["bins"], 4);
    assert_eq!(
        value["candidates"]["freqs"],
        json!([110.0, 220.0, 440.0, 880.0])
    );
    assert_eq!(value["candidates"]["values"]["length"], 16);
    // The octave flags are parallel to the frames, counted rather than listed.
    assert_eq!(value["octaveAmbiguous"]["length"], 4);
    assert_eq!(value["octaveAmbiguous"]["ambiguous"], 1);
}

#[test]
fn decimation_thins_the_candidate_grid_with_the_frames() {
    let value = shape(&AnalysisResult::PitchPyin(pitch()), Shape::Full, Some(2))
        .expect("full returns a result");
    // `indices(4, 2)` keeps frames 0 and 3 in every parallel array.
    assert_eq!(value["times"].as_array().unwrap().len(), 2);
    assert_eq!(value["octaveAmbiguous"].as_array().unwrap().len(), 2);
    // Two rows × four columns, so the grid still holds `frames * bins` cells.
    let cells = value["candidates"]["values"].as_array().unwrap();
    assert_eq!(cells.len(), 8);
    // The kept rows are frames 0 and 3, so the first cell of each survives.
    let cell = |value: &serde_json::Value| value.as_f64().unwrap() as f32;
    assert!((cell(&cells[0]) - 0.1).abs() < 1e-6);
    assert!((cell(&cells[4]) - 0.05).abs() < 1e-6);
    assert_eq!(value["candidates"]["sourceFrames"], 4);
}

#[test]
fn compact_loudness_keeps_the_rms_and_spl_comparators() {
    let value = shape(&AnalysisResult::Loudness(loudness()), Shape::Compact, None)
        .expect("compact returns a result");
    assert_eq!(value["frameRmsDb"]["length"], 4);
    assert_eq!(value["frameRmsDb"]["max"], -24.0);
    assert_eq!(value["frameSplDb"]["length"], 4);
    assert_eq!(value["frameSplDb"]["max"], 70.0);
}

#[test]
fn decimation_thins_the_loudness_comparators_with_times() {
    let value = shape(&AnalysisResult::Loudness(loudness()), Shape::Full, Some(2))
        .expect("full returns a result");
    assert_eq!(value["times"].as_array().unwrap().len(), 2);
    assert_eq!(value["frameRmsDb"].as_array().unwrap().len(), 2);
    assert_eq!(value["frameSplDb"].as_array().unwrap().len(), 2);
}

fn matrix_4x2() -> MatrixResult {
    MatrixResult {
        sample_rate: 48_000,
        hop_size: 480,
        frames: 4,
        bins: 2,
        duration: 0.4,
        times: vec![0.0, 0.1, 0.2, 0.3],
        window_start: 0.0,
        bands: vec![0.0, 1.0],
        values: vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0],
        min_value: 1.0,
        max_value: 8.0,
        ..Default::default()
    }
}
