//! Tests for the single result shaper (`shape_result` / `compact` / `decimate`).

use serde_json::json;

use crate::audio::analysis::fixtures::{matrix, notes, rhythm, series, spectrum};
use crate::audio::analysis::{decimate, shape_result, AnalysisResult, Shape};

#[test]
fn compact_spectrum_keeps_the_peak_and_collapses_the_arrays() {
    let value = shape_result(&AnalysisResult::Spectrum(spectrum()), Shape::Compact, None)
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
    let value = shape_result(&AnalysisResult::Mfcc(matrix()), Shape::Compact, None)
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
fn compact_series_counts_gaps_instead_of_returning_arrays() {
    let value = shape_result(
        &AnalysisResult::SpectralCentroid(series()),
        Shape::Compact,
        None,
    )
    .expect("compact returns a result");
    assert_eq!(value["values"]["length"], 4);
    assert_eq!(value["values"]["nulls"], 1);
    assert_eq!(value["values"]["argmax"], 2);
    assert_eq!(value["times"]["start"], 0.0);
}

#[test]
fn compact_rhythm_previews_the_event_lists() {
    let value = shape_result(&AnalysisResult::Tempo(rhythm()), Shape::Compact, None)
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
fn compact_notes_previews_the_note_records() {
    let value = shape_result(&AnalysisResult::NoteMetrics(notes()), Shape::Compact, None)
        .expect("compact returns a result");
    assert_eq!(value["noteCount"], 1);
    assert_eq!(value["notes"]["length"], 1);
    assert_eq!(value["notes"]["truncated"], false);
    assert_eq!(value["notes"]["preview"][0]["rmsDb"], -18.0);
    assert_eq!(value["gaps"]["length"], 1);
}

#[test]
fn summary_shape_returns_no_result() {
    assert!(shape_result(&AnalysisResult::Spectrum(spectrum()), Shape::Summary, None).is_none());
}

#[test]
fn full_shape_is_raw_and_decimates_on_request() {
    let full = shape_result(&AnalysisResult::Spectrum(spectrum()), Shape::Full, None)
        .expect("full returns a result");
    assert_eq!(full["magDb"].as_array().unwrap().len(), 3);

    let decimated = shape_result(&AnalysisResult::Spectrum(spectrum()), Shape::Full, Some(2))
        .expect("full returns a result");
    assert_eq!(decimated["magDb"].as_array().unwrap().len(), 2);
}

#[test]
fn decimate_strides_keeping_first_and_last() {
    let value = json!({ "values": (0..100).map(|n| n as f64).collect::<Vec<_>>() });
    let out = decimate(value, 10);
    let values = out["values"].as_array().unwrap();
    assert_eq!(values.len(), 10);
    assert_eq!(values[0], 0.0);
    assert_eq!(values[9], 99.0);
    // A uniform stride of 11: index 1 lands on round(11) = 11.
    assert_eq!(values[1], 11.0);
    // Short arrays pass through untouched.
    let short = decimate(json!({ "values": [1.0, 2.0, 3.0] }), 10);
    assert_eq!(short["values"].as_array().unwrap().len(), 3);
}
