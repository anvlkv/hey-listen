//! Note-segmentation tests (M18): tone → gap → tone, continuous tone, gap merging,
//! relative levels, silence, and option aliases.

use super::*;

fn tone(hz: f32, amplitude: f32, seconds: f32) -> Vec<f32> {
    let frames = (seconds * RATE as f32) as usize;
    (0..frames)
        .map(|i| amplitude * (std::f32::consts::TAU * hz * i as f32 / RATE as f32).sin())
        .collect()
}

fn silence(seconds: f32) -> Vec<f32> {
    vec![0.0; (seconds * RATE as f32) as usize]
}

fn run_notes(mono: &[f32], options: &ToolOptions) -> NoteMetricsResult {
    match run("noteMetrics", mono, RATE, &params(2048), options).expect("note metrics") {
        AnalysisResult::NoteMetrics(result) => result,
        other => panic!("unexpected result: {other:?}"),
    }
}

#[test]
fn tone_gap_tone_yields_two_notes_and_one_gap() {
    let mut mono = tone(440.0, 0.5, 0.2);
    mono.extend(silence(0.1));
    mono.extend(tone(440.0, 0.5, 0.2));
    let result = run_notes(&mono, &ToolOptions::default());

    assert_eq!(result.note_count, 2, "notes: {:?}", result.notes);
    assert_eq!(result.gap_count, 1);
    assert_eq!(result.notes.len(), 2);
    assert_eq!(result.gaps.len(), 1);
    // The two tones are 200 ms long, with roughly 100 ms of silence between.
    for note in &result.notes {
        assert!(
            (note.duration_secs - 0.2).abs() < 0.03,
            "duration = {}",
            note.duration_secs
        );
    }
    assert!(
        (result.gaps[0].duration_secs - 0.1).abs() < 0.03,
        "gap = {}",
        result.gaps[0].duration_secs
    );
    // Leading / trailing silence is a note gap, not a counted gap.
    assert!(result.notes[0].gap_before_secs < 0.02);
    assert!(result.notes[1].gap_after_secs < 0.02);
    assert!((result.notes[0].gap_after_secs - 0.1).abs() < 0.03);
    assert!((result.notes[1].gap_before_secs - 0.1).abs() < 0.03);
    assert!((result.total_gap_secs - result.gaps[0].duration_secs).abs() < 1e-6);
    assert!((result.longest_gap_secs - result.gaps[0].duration_secs).abs() < 1e-6);
    assert!((result.median_note_secs - 0.2).abs() < 0.03);
    // The envelope describes each note at the same normalized positions.
    assert_eq!(result.envelope_positions.len(), 7);
    assert_eq!(result.envelope_positions[0], 0.0);
    assert_eq!(result.envelope_positions[6], 1.0);
    assert!(result.notes.iter().all(|note| note.envelope_db.len() == 7));
    // The gate is reported so a caller can tell how the notes were found.
    assert!(result.threshold_db < -30.0 && result.threshold_db > -60.0);
}

#[test]
fn a_continuous_tone_is_one_note_with_no_gaps() {
    let mono = tone(440.0, 0.5, 0.5);
    let result = run_notes(&mono, &ToolOptions::default());
    assert_eq!(result.note_count, 1, "notes: {:?}", result.notes);
    assert_eq!(result.gap_count, 0);
    assert!(result.reference_note_index == Some(0));
    assert!(result.notes[0].gap_before_secs < 0.02);
    assert!(result.notes[0].gap_after_secs < 0.02);
    assert!((result.notes[0].duration_secs - 0.5).abs() < 0.03);
}

#[test]
fn a_gap_shorter_than_the_minimum_is_merged() {
    let mut mono = tone(440.0, 0.5, 0.15);
    mono.extend(silence(0.02));
    mono.extend(tone(440.0, 0.5, 0.15));
    let result = run_notes(&mono, &ToolOptions::default());
    assert_eq!(result.note_count, 1, "notes: {:?}", result.notes);
    assert_eq!(result.gap_count, 0);
}

#[test]
fn relative_levels_are_measured_against_the_loudest_note() {
    let mut mono = tone(440.0, 0.5, 0.2);
    mono.extend(silence(0.1));
    mono.extend(tone(440.0, 0.25, 0.2));
    let result = run_notes(&mono, &ToolOptions::default());
    assert_eq!(result.note_count, 2);
    assert_eq!(result.reference_note_index, Some(0));
    assert!(result.notes[0].rms_db_rel_loudest.abs() < 1e-4);
    assert!(result.notes[0].peak_db_rel_loudest.abs() < 1e-4);
    // Halving the amplitude is about −6 dB.
    assert!(
        (result.notes[1].rms_db_rel_loudest + 6.02).abs() < 0.5,
        "relative RMS = {}",
        result.notes[1].rms_db_rel_loudest
    );
    assert!(
        (result.notes[1].peak_db_rel_loudest + 6.02).abs() < 0.5,
        "relative peak = {}",
        result.notes[1].peak_db_rel_loudest
    );
}

#[test]
fn a_silent_window_has_no_notes() {
    let mono = silence(0.5);
    let result = run_notes(&mono, &ToolOptions::default());
    assert_eq!(result.note_count, 0);
    assert_eq!(result.gap_count, 0);
    assert_eq!(result.total_gap_secs, 0.0);
    assert_eq!(result.longest_gap_secs, 0.0);
    assert_eq!(result.median_note_secs, 0.0);
    assert_eq!(result.median_gap_secs, 0.0);
    assert_eq!(result.reference_note_index, None);
    assert!(result.notes.is_empty() && result.gaps.is_empty());
}

#[test]
fn note_options_accept_snake_case_aliases() {
    let options: ToolOptions = serde_json::from_str(
        r#"{ "gate_db": 40, "gate_floor_db": -55, "min_note_ms": 15, "min_gap_ms": 25 }"#,
    )
    .expect("aliases parse");
    assert_eq!(options.gate_db, Some(40.0));
    assert_eq!(options.gate_floor_db, Some(-55.0));
    assert_eq!(options.min_note_ms, Some(15.0));
    assert_eq!(options.min_gap_ms, Some(25.0));
}
