//! Unit tests for the shared AM/FM measurement core, split out of `modulation_core.rs`
//! for the source-size budget.

use super::*;

/// A run's cents track at `sample_rate` samples per second, with its measured depth.
fn part(cents: Vec<f32>, sample_rate: f32) -> FmPart {
    let (peak_to_peak_cents, std_cents) = depth(&cents);
    let end_secs = cents.len() as f32 / sample_rate.max(1.0);
    FmPart {
        measured: cents.clone(),
        cents,
        sample_rate,
        start_secs: 0.0,
        end_secs,
        peak_to_peak_cents,
        std_cents,
    }
}

/// A synthetic pitch frame, voiced or not, at `hz`.
fn pitch(hz: f32, voiced: bool) -> oxiaudio::dsp::PitchFrame {
    oxiaudio::dsp::PitchFrame {
        time_seconds: 0.0,
        frequency_hz: hz,
        confidence: 1.0,
        is_voiced: voiced,
    }
}

#[test]
fn a_quantized_staircase_is_not_a_reliable_fm_rate() {
    // The Snowy Owl case: four levels over 13 frames. A spectrum fit invents a
    // 31.5 Hz vibrato; the reliability guard must reject it (M21.B).
    let pattern = [392.0f32, 415.0, 392.0, 370.0];
    let cents: Vec<f32> = (0..13).map(|index| pattern[index % 4] - 392.0).collect();
    let part = part(cents, 200.0);
    assert!(part.std_cents > MIN_FM_STD_CENTS);
    assert!(!fm_is_reliable(&part, 0.05));
}

#[test]
fn a_smooth_vibrato_is_reliable() {
    let cents: Vec<f32> = (0..200)
        .map(|index| 25.0 * (index as f32 * 0.08).sin())
        .collect();
    assert!(fm_is_reliable(&part(cents, 200.0), 0.2));
}

#[test]
fn a_steady_run_is_reliable_and_has_no_rate() {
    let part = part(vec![0.0; 200], 200.0);
    assert!(fm_is_reliable(&part, 0.2));
    assert!(part.std_cents < MIN_FM_STD_CENTS);
}

#[test]
fn interpolated_gaps_cannot_fabricate_a_distinct_pitch_track() {
    // Three measured levels, each bridged over a short gap. The interpolated series
    // spans enough frames and levels to pass the old guards on its own, but only
    // three of its values were actually measured.
    let mut frames = Vec::new();
    for (group, hz) in [(0, 400.0f32), (1, 440.0), (2, 480.0)] {
        if group > 0 {
            frames.extend((0..6).map(|_| pitch(0.0, false)));
        }
        frames.extend((0..3).map(|_| pitch(hz, true)));
    }
    for (index, frame) in frames.iter_mut().enumerate() {
        frame.time_seconds = index as f64 * 0.005;
    }
    let run = longest_voiced_run(&frames, 0.005, 0.0).expect("a bridged fine run");
    let track = cents_track(&frames, run);
    assert!(track.series.len() >= MIN_FM_FRAMES);
    assert!(distinct_cents(&track.series) >= MIN_FM_DISTINCT_CENTS);
    let mut part = part(track.series, 200.0);
    assert!(part.std_cents > MIN_FM_STD_CENTS);
    part.measured = track.measured;
    assert_eq!(distinct_cents(&part.measured), 3);
    assert!(!fm_is_reliable(&part, 0.0));
}

#[test]
fn boundary_maxima_get_one_sided_prominence() {
    let freqs = [1.0, 2.0, 3.0, 4.0, 5.0];
    let found = peaks(&freqs, &[0.0, -20.0, -30.0, -20.0, 0.0], 3);
    assert_eq!(found.len(), 2, "both ends: {found:?}");
    assert!(found.iter().all(|peak| peak.prominence_db >= 20.0));
}

#[test]
fn the_retained_span_is_the_frames_plus_half_a_hop() {
    let mut frames: Vec<_> = (0..4).map(|_| pitch(440.0, true)).collect();
    for (index, frame) in frames.iter_mut().enumerate() {
        frame.time_seconds = index as f64 * 0.01;
    }
    let run = VoicedRun { first: 1, last: 2 };
    let (start, end) = run_span_secs(&frames, run, 0.01, 0.1, 1.0);
    assert!((start - 0.105).abs() < 1e-5 && (end - 0.125).abs() < 1e-5);
    // Clamped to the signal, so the span never leaves the analysed region.
    let (start, end) = run_span_secs(&frames, run, 0.01, 0.0, 0.015);
    assert!((start - 0.005).abs() < 1e-5 && (end - 0.015).abs() < 1e-5);
}

#[test]
fn a_run_shorter_than_min_voiced_secs_is_not_reliable() {
    let cents: Vec<f32> = (0..13)
        .map(|index| 25.0 * (index as f32 * 0.5).sin())
        .collect();
    assert!(!fm_is_reliable(&part(cents, 200.0), 0.2));
}
