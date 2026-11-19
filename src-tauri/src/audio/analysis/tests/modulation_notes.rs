//! Per-note modulation (D-18): the `modulation` tool's `perNote` option segments the
//! window with the M18 gate and reports each detected note's own AM/FM readouts.
//!
//! The signals come from the same synth graphs the M20 tests use (`sine` × `sine_lfo`
//! for AM), so the expected rate of each burst is known exactly.

use super::modulation::{am_tone, has_peak, mod_options, render, run_mod, MOD_RATE};
use super::*;

#[test]
fn per_note_off_leaves_the_window_result_unchanged() {
    let mono = render(&am_tone(440.0, &[(10.0, 0.5)]), 1.0);
    let default = run_mod(&mono, &mod_options());
    let off = run_mod(
        &mono,
        &ToolOptions {
            per_note: Some(0.0),
            ..mod_options()
        },
    );

    assert!(default.notes.is_empty());
    assert!(off.notes.is_empty());
    // The switch is the only difference: off, it changes nothing in the window result.
    assert_eq!(
        serde_json::to_value(&off).expect("json"),
        serde_json::to_value(&default).expect("json")
    );
    // The window readouts are still the graph's 10 Hz, 50 % AM.
    let peak = off.am_peaks.first().expect("an AM peak");
    assert!(
        (peak.rate_hz - 10.0).abs() < 1.5,
        "top AM rate = {} Hz",
        peak.rate_hz
    );
    assert!(off.am_depth.is_some_and(|depth| (depth - 0.5).abs() < 0.1));
}

#[test]
fn per_note_reports_each_bursts_own_rate() {
    // Two AM bursts at different tremolo rates, separated by 0.3 s of silence.
    let mut mono = render(&am_tone(440.0, &[(8.0, 0.5)]), 0.6);
    mono.extend(std::iter::repeat_n(
        0.0f32,
        (0.3 * MOD_RATE as f32) as usize,
    ));
    mono.extend(render(&am_tone(440.0, &[(24.0, 0.5)]), 0.6));

    let result = run_mod(
        &mono,
        &ToolOptions {
            per_note: Some(1.0),
            ..mod_options()
        },
    );

    assert_eq!(result.notes.len(), 2, "one note per burst");
    let (first, second) = (&result.notes[0], &result.notes[1]);
    assert!(
        (first.start_secs - 0.0).abs() < 0.06,
        "first start = {}",
        first.start_secs
    );
    assert!(
        (first.end_secs - 0.6).abs() < 0.06,
        "first end = {}",
        first.end_secs
    );
    assert!(
        (second.start_secs - 0.9).abs() < 0.06,
        "second start = {}",
        second.start_secs
    );
    assert!(
        has_peak(&first.am_peaks, 8.0, 1.5),
        "first peaks: {:?}",
        first.am_peaks
    );
    assert!(
        has_peak(&second.am_peaks, 24.0, 2.0),
        "second peaks: {:?}",
        second.am_peaks
    );
    assert!(first.am_depth.is_some() && second.am_depth.is_some());
}

#[test]
fn a_silent_window_has_no_notes_even_when_asked() {
    let mono = vec![0.0f32; (0.5 * MOD_RATE as f32) as usize];
    let result = run_mod(
        &mono,
        &ToolOptions {
            per_note: Some(1.0),
            ..mod_options()
        },
    );

    assert!(result.notes.is_empty(), "notes: {:?}", result.notes);
}

#[test]
fn a_note_below_the_cores_minimum_is_skipped_not_a_panic() {
    // A 1 ms burst: the segmenter reports it (no minimum note length), but the core has
    // too few samples to measure, so it is skipped rather than padded into a rate.
    let mut mono = vec![0.0f32; (0.3 * MOD_RATE as f32) as usize];
    let burst = (0.001 * MOD_RATE as f32) as usize;
    for (index, sample) in mono[1_000..1_000 + burst].iter_mut().enumerate() {
        *sample = 0.4 * (std::f32::consts::TAU * 440.0 * index as f32 / MOD_RATE as f32).sin();
    }
    let options = ToolOptions {
        frame_ms: Some(0.5),
        hop_ms: Some(0.5),
        min_note_ms: Some(0.0),
        per_note: Some(1.0),
        ..mod_options()
    };

    let result = run_mod(&mono, &options);
    assert!(result.notes.is_empty(), "notes: {:?}", result.notes);
}
