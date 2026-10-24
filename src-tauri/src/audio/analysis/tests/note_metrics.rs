//! Note-segmentation tests (M18): tone → gap → tone, continuous tone, gap merging,
//! relative levels, silence, and option aliases.

use super::*;

/// A lower rate keeps the per-note YIN passes in these proxy tests quick; everything
/// they measure is well below its Nyquist.
const QUALITY_RATE: u32 = 16_000;

fn tone(hz: f32, amplitude: f32, seconds: f32) -> Vec<f32> {
    tone_at(hz, amplitude, seconds, RATE)
}

fn tone_at(hz: f32, amplitude: f32, seconds: f32, rate: u32) -> Vec<f32> {
    let frames = (seconds * rate as f32) as usize;
    (0..frames)
        .map(|i| amplitude * (std::f32::consts::TAU * hz * i as f32 / rate as f32).sin())
        .collect()
}

/// A tone whose frequency wobbles `depth` (a fraction) at `vibrato_hz`.
fn vibrato_tone(
    hz: f32,
    depth: f32,
    vibrato_hz: f32,
    amplitude: f32,
    seconds: f32,
    rate: u32,
) -> Vec<f32> {
    let frames = (seconds * rate as f32) as usize;
    let mut phase = 0.0f32;
    (0..frames)
        .map(|i| {
            let t = i as f32 / rate as f32;
            let frequency = hz * (1.0 + depth * (std::f32::consts::TAU * vibrato_hz * t).sin());
            let sample = amplitude * phase.sin();
            phase += std::f32::consts::TAU * frequency / rate as f32;
            sample
        })
        .collect()
}

/// A tone amplitude-modulated at `mod_hz`; `depth` 0.6 leaves 40–100% of the level.
fn amplitude_modulated(
    hz: f32,
    depth: f32,
    mod_hz: f32,
    amplitude: f32,
    seconds: f32,
    rate: u32,
) -> Vec<f32> {
    let frames = (seconds * rate as f32) as usize;
    (0..frames)
        .map(|i| {
            let t = i as f32 / rate as f32;
            let envelope = 1.0 - depth * 0.5 * (1.0 - (std::f32::consts::TAU * mod_hz * t).cos());
            amplitude * envelope * (std::f32::consts::TAU * hz * t).sin()
        })
        .collect()
}

/// Deterministic white noise (a small LCG, so the test needs no RNG dependency).
fn noise(amplitude: f32, seconds: f32, rate: u32) -> Vec<f32> {
    let frames = (seconds * rate as f32) as usize;
    let mut state = 0x1234_5678u32;
    (0..frames)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let unit = (state >> 8) as f32 / (1u32 << 24) as f32;
            amplitude * (unit * 2.0 - 1.0)
        })
        .collect()
}

fn silence(seconds: f32) -> Vec<f32> {
    vec![0.0; (seconds * RATE as f32) as usize]
}

fn run_notes(mono: &[f32], options: &ToolOptions) -> NoteMetricsResult {
    run_notes_at(mono, RATE, options)
}

fn run_notes_at(mono: &[f32], rate: u32, options: &ToolOptions) -> NoteMetricsResult {
    match run("noteMetrics", mono, rate, &params(2048), options).expect("note metrics") {
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

#[test]
fn pitch_proxies_accept_snake_case_aliases() {
    let options: ToolOptions = serde_json::from_str(
        r#"{ "pitch_frame_ms": 30, "pitch_hop_ms": 2, "min_f0_hz": 80, "max_f0_hz": 1000 }"#,
    )
    .expect("aliases parse");
    assert_eq!(options.pitch_frame_ms, Some(30.0));
    assert_eq!(options.pitch_hop_ms, Some(2.0));
    assert_eq!(options.min_f0_hz, Some(80.0));
    assert_eq!(options.max_f0_hz, Some(1000.0));
}

#[test]
fn a_steady_note_has_near_zero_jitter_and_shimmer() {
    let mono = tone_at(440.0, 0.5, 0.5, QUALITY_RATE);
    let result = run_notes_at(&mono, QUALITY_RATE, &ToolOptions::default());
    assert_eq!(result.note_count, 1, "notes: {:?}", result.notes);

    let note = &result.notes[0];
    let jitter = note.jitter_proxy_cents.expect("enough voiced frames");
    let shimmer = note.shimmer_proxy_db.expect("enough frames");
    let hnr = note.hnr_proxy.expect("a periodic note");
    assert!(
        note.voiced_fraction.is_some_and(|f| f > 0.9),
        "voiced_fraction = {:?}",
        note.voiced_fraction
    );
    assert!(
        (note.f0_median_hz.unwrap_or(0.0) - 440.0).abs() < 3.0,
        "f0 = {:?}",
        note.f0_median_hz
    );
    assert!(jitter < 2.0, "jitter = {jitter} cents");
    assert!(shimmer < 1.0, "shimmer = {shimmer} dB");
    assert!(hnr > 0.9, "hnr proxy = {hnr}");
}

#[test]
fn vibrato_raises_the_jitter_proxy() {
    let steady = run_notes_at(
        &tone_at(440.0, 0.5, 0.5, QUALITY_RATE),
        QUALITY_RATE,
        &ToolOptions::default(),
    );
    let vibrato = run_notes_at(
        &vibrato_tone(440.0, 0.03, 6.0, 0.5, 0.5, QUALITY_RATE),
        QUALITY_RATE,
        &ToolOptions::default(),
    );

    assert_eq!(steady.note_count, 1);
    assert_eq!(vibrato.note_count, 1, "notes: {:?}", vibrato.notes);
    let steady_jitter = steady.notes[0].jitter_proxy_cents.unwrap();
    let vibrato_jitter = vibrato.notes[0].jitter_proxy_cents.unwrap();
    assert!(
        vibrato_jitter > steady_jitter + 3.0 && vibrato_jitter > 10.0,
        "steady = {steady_jitter}, vibrato = {vibrato_jitter}"
    );
}

#[test]
fn amplitude_modulation_raises_the_shimmer_proxy() {
    let steady = run_notes_at(
        &tone_at(440.0, 0.5, 0.5, QUALITY_RATE),
        QUALITY_RATE,
        &ToolOptions::default(),
    );
    let modulated = run_notes_at(
        &amplitude_modulated(440.0, 0.6, 20.0, 0.5, 0.5, QUALITY_RATE),
        QUALITY_RATE,
        &ToolOptions::default(),
    );

    assert_eq!(steady.note_count, 1);
    assert_eq!(modulated.note_count, 1, "notes: {:?}", modulated.notes);
    let steady_shimmer = steady.notes[0].shimmer_proxy_db.unwrap();
    let modulated_shimmer = modulated.notes[0].shimmer_proxy_db.unwrap();
    assert!(
        modulated_shimmer > steady_shimmer + 1.0,
        "steady = {steady_shimmer}, modulated = {modulated_shimmer}"
    );
}

#[test]
fn noise_lowers_the_hnr_proxy() {
    let tone_note = run_notes_at(
        &tone_at(440.0, 0.5, 0.5, QUALITY_RATE),
        QUALITY_RATE,
        &ToolOptions::default(),
    );
    let noise_note = run_notes_at(
        &noise(0.5, 0.5, QUALITY_RATE),
        QUALITY_RATE,
        &ToolOptions::default(),
    );

    assert_eq!(noise_note.note_count, 1, "notes: {:?}", noise_note.notes);
    let tone_hnr = tone_note.notes[0].hnr_proxy.unwrap();
    let noise_hnr = noise_note.notes[0].hnr_proxy.unwrap();
    assert!(
        noise_hnr < tone_hnr - 0.3 && noise_hnr < 0.5,
        "tone = {tone_hnr}, noise = {noise_hnr}"
    );
}

#[test]
fn a_short_note_returns_null_pitch_proxies() {
    // 30 ms is long enough to count as a note but yields one pitch frame at most.
    let mono = tone_at(440.0, 0.5, 0.03, QUALITY_RATE);
    let options = ToolOptions {
        min_note_ms: Some(10.0),
        ..ToolOptions::default()
    };
    let result = run_notes_at(&mono, QUALITY_RATE, &options);

    assert_eq!(result.note_count, 1, "notes: {:?}", result.notes);
    let note = &result.notes[0];
    assert!(
        note.jitter_proxy_cents.is_none(),
        "jitter = {:?}",
        note.jitter_proxy_cents
    );
    assert!(note.hnr_proxy.is_none(), "hnr = {:?}", note.hnr_proxy);
}
