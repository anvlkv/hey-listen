//! Unit tests for the analysis engine (split out of `mod.rs`).

use super::support::effective_hop;
use super::*;

const RATE: u32 = 48_000;

fn sine(hz: f32, seconds: f32) -> Vec<f32> {
    let frames = (seconds * RATE as f32) as usize;
    (0..frames)
        .map(|i| 0.5 * (std::f32::consts::TAU * hz * i as f32 / RATE as f32).sin())
        .collect()
}

fn params(fft_size: usize) -> SharedParams {
    SharedParams {
        fft_size,
        hop: 0.25,
        randomized_overlap: false,
        window_fn: WindowKind::Hann,
        channel: None,
        resample_to: None,
        freq_min_hz: 0.0,
        freq_max_hz: 0.0,
    }
}

mod frame_rms;
mod gating;
mod modulation;
mod note_metrics;
mod pitch;

#[test]
fn waveform_reports_half_scale_sine() {
    let mono = sine(1_000.0, 0.5);
    let result = waveform(&mono, RATE);
    assert_eq!(result.frames, mono.len());
    assert!((result.peak - 0.5).abs() < 0.02, "peak = {}", result.peak);
    // A full-scale sine has RMS = peak / sqrt(2).
    assert!(
        (result.rms - 0.5 / 2f32.sqrt()).abs() < 0.02,
        "rms = {}",
        result.rms
    );
    assert!(!result.min.is_empty() && result.min.len() == result.max.len());
}

#[test]
fn spectrum_peaks_at_the_sine_frequency() {
    let mono = sine(1_000.0, 0.5);
    let result = spectrum(&mono, RATE, &params(4096)).expect("spectrum");
    assert!(!result.freqs.is_empty());
    assert!(
        (result.peak_hz - 1_000.0).abs() < 30.0,
        "peak_hz = {}",
        result.peak_hz
    );
    // A half-scale sine reads about −6 dBFS after normalization.
    assert!(
        (result.peak_db + 6.0).abs() < 3.0,
        "peak_db = {}",
        result.peak_db
    );
    // The per-bin min / max layers bracket the mean, one entry per bin.
    assert_eq!(result.min_db.len(), result.freqs.len());
    assert_eq!(result.max_db.len(), result.freqs.len());
    for k in 0..result.freqs.len() {
        assert!(
            result.min_db[k] <= result.mag_db[k] + 1e-3
                && result.mag_db[k] <= result.max_db[k] + 1e-3,
            "bin {k}: min {} mean {} max {}",
            result.min_db[k],
            result.mag_db[k],
            result.max_db[k]
        );
    }
}

#[test]
fn spectrum_respects_the_band_limit() {
    let mono = sine(1_000.0, 0.5);
    let mut p = params(4096);
    p.freq_min_hz = 2_000.0;
    p.freq_max_hz = 4_000.0;
    let result = spectrum(&mono, RATE, &p).expect("spectrum");
    assert!(result
        .freqs
        .iter()
        .all(|&f| (2_000.0..=4_000.0).contains(&f)));
}

#[test]
fn spectrogram_has_matching_dimensions() {
    let mono = sine(1_000.0, 0.5);
    let result = spectrogram(&mono, RATE, &params(1024)).expect("spectrogram");
    assert_eq!(result.bins, result.freqs.len());
    assert_eq!(result.mag_db.len(), result.frames * result.bins);
    assert!(result.max_db >= result.min_db);
}

#[test]
fn condition_mixdowns_then_filters() {
    // Stereo region, downmix of two channels, then identity (no filter).
    let region = vec![1.0, 0.0, 0.0, 1.0, 0.5, 0.5, -0.5, -0.5];
    let (mono, rate) = condition(&region, 2, RATE, None, None, None).expect("condition");
    assert_eq!(rate, RATE);
    assert_eq!(mono, vec![0.5, 0.5, 0.5, -0.5]);
}

#[test]
fn condition_selects_a_channel_and_resamples() {
    // Right channel carries DC 0.9; downsampling keeps the value.
    let region = vec![0.0, 0.9, 0.0, 0.9];
    let (mono, rate) = condition(&region, 2, RATE, None, Some(1), Some(24_000)).expect("condition");
    assert_eq!(rate, 24_000);
    assert_eq!(mono.len(), 1);
    assert!((mono[0] - 0.9).abs() < 1e-5, "mono[0] = {}", mono[0]);
}

#[test]
fn long_window_raises_the_hop() {
    // A large FFT over a long buffer widens the fine requested hop to bound memory.
    let fft = 8192;
    let len = 60 * 48_000;
    let hop = effective_hop(fft, len, 512);
    assert!(hop > 512, "hop = {hop}");
    let bins = fft / 2 + 1;
    let frames = (len - fft) / hop + 1;
    assert!(frames * bins <= MAX_STFT_CELLS + bins, "frames = {frames}");
}

#[test]
fn short_buffer_keeps_the_requested_hop() {
    assert_eq!(effective_hop(2048, 1_000, 512), 512);
}

#[test]
fn short_window_is_zero_padded() {
    // Fewer samples than the FFT still yields one (zero-padded) frame.
    let mono = sine(1_000.0, 0.005);
    let result = spectrum(&mono, RATE, &params(2048)).expect("spectrum");
    assert!(result.frames >= 1, "frames = {}", result.frames);
    assert!(!result.freqs.is_empty());
}

#[test]
fn unknown_tool_is_an_error() {
    assert!(matches!(
        run("nope", &[0.0], RATE, &params(1024), &ToolOptions::default()),
        Err(AnalysisError::UnknownTool(_))
    ));
}

#[test]
fn level_meters_match_the_waveform_readouts() {
    let mono = sine(1_000.0, 0.5);
    let result = levels(&mono, RATE);
    assert_eq!(result.frames, mono.len());
    assert!((result.peak - 0.5).abs() < 0.02, "peak = {}", result.peak);
    assert!(
        (result.peak_db + 6.0).abs() < 1.0,
        "peak_db = {}",
        result.peak_db
    );
}

#[test]
fn spectral_features_return_one_value_per_frame() {
    let mono = sine(1_000.0, 0.5);
    let p = params(2048);
    let options = ToolOptions::default();
    let centroid = run("spectralCentroid", &mono, RATE, &p, &options).expect("centroid");
    match centroid {
        AnalysisResult::SpectralCentroid(series) => {
            assert!(series.frames > 0);
            assert_eq!(series.values.len(), series.frames);
            assert_eq!(series.times.len(), series.frames);
            // A 1 kHz sine has its energy near 1 kHz.
            let mean: f32 =
                series.values.iter().flatten().copied().sum::<f32>() / series.frames as f32;
            assert!((mean - 1_000.0).abs() < 120.0, "mean centroid = {mean}");
        }
        other => panic!("unexpected result: {other:?}"),
    }
}

#[test]
fn chromagram_has_twelve_bands() {
    let mono = sine(440.0, 0.5);
    let result = chromagram(&mono, RATE, &params(2048)).expect("chromagram");
    assert_eq!(result.bins, 12);
    assert_eq!(result.values.len(), result.frames * 12);
}

#[test]
fn pitch_marks_unvoiced_frames_as_gaps() {
    // A pure tone is voiced; the tail (silence) should not be.
    let mut mono = sine(440.0, 0.5);
    mono.extend(std::iter::repeat_n(0.0, RATE as usize / 4));
    let result = match run(
        "pitchPyin",
        &mono,
        RATE,
        &params(2048),
        &ToolOptions::default(),
    )
    .expect("pitch")
    {
        AnalysisResult::PitchPyin(series) => series,
        other => panic!("unexpected result: {other:?}"),
    };
    assert!(result.frames > 0);
    let voiced = result.values.iter().flatten().count();
    assert!(voiced > 0, "expected some voiced frames");
    assert!(voiced < result.frames, "expected some silent gaps");
    // The voiced summary matches the values, so a near-empty track is visible
    // without scanning the series.
    assert_eq!(result.voiced_frames, voiced);
    let expected = voiced as f32 / result.frames as f32;
    assert!(
        (result.voiced_fraction - expected).abs() < 1e-6,
        "voiced_fraction = {}",
        result.voiced_fraction
    );
}

#[test]
fn loudness_tools_return_finite_values() {
    let mono = sine(1_000.0, 1.0);
    match run(
        "loudnessIntegrated",
        &mono,
        RATE,
        &params(2048),
        &ToolOptions::default(),
    )
    .expect("lufs")
    {
        AnalysisResult::LoudnessIntegrated(result) => {
            assert!(result.lufs.is_finite(), "lufs = {}", result.lufs);
        }
        other => panic!("unexpected result: {other:?}"),
    }
}

#[test]
fn tempo_and_onsets_run_without_error() {
    let mono = sine(1_000.0, 1.0);
    let options = ToolOptions::default();
    assert!(run("tempo", &mono, RATE, &params(2048), &options).is_ok());
    assert!(run("onsets", &mono, RATE, &params(2048), &options).is_ok());
    assert!(run("downbeats", &mono, RATE, &params(2048), &options).is_ok());
}

#[test]
fn short_window_pads_library_tools() {
    // A handful of samples: the library's frame-based features (unlike our STFT)
    // do not pad, so without padding these would come back empty.
    let mono: Vec<f32> = vec![0.1, -0.1, 0.05, -0.05, 0.2, -0.2, 0.1, -0.1];
    let p = params(2048);
    let options = ToolOptions::default();
    match run("chromagram", &mono, RATE, &p, &options).expect("chromagram") {
        AnalysisResult::Chromagram(r) => {
            assert!(r.frames >= 1, "frames = {}", r.frames);
            assert_eq!(r.bins, 12);
        }
        other => panic!("unexpected result: {other:?}"),
    }
    match run("spectralCentroid", &mono, RATE, &p, &options).expect("centroid") {
        AnalysisResult::SpectralCentroid(r) => {
            assert!(r.frames >= 1, "frames = {}", r.frames)
        }
        other => panic!("unexpected result: {other:?}"),
    }
}

#[test]
fn pitch_frames_are_capped() {
    // A long window keeps the O(frames × lags) pitch tools bounded.
    let mono = sine(440.0, 30.0);
    let pitch = match run(
        "pitchYin",
        &mono,
        RATE,
        &params(2048),
        &ToolOptions::default(),
    )
    .expect("pitch")
    {
        AnalysisResult::PitchYin(r) => r,
        other => panic!("unexpected result: {other:?}"),
    };
    assert!(pitch.frames > 0);
    assert!(
        pitch.frames <= MAX_PITCH_FRAMES,
        "frames = {}",
        pitch.frames
    );
}

#[test]
fn rhythm_result_carries_the_envelope() {
    let mono = sine(1_000.0, 1.0);
    let r = match run(
        "onsets",
        &mono,
        RATE,
        &params(2048),
        &ToolOptions::default(),
    )
    .expect("onsets")
    {
        AnalysisResult::Onsets(r) => r,
        other => panic!("unexpected result: {other:?}"),
    };
    assert!(!r.onset_strength.is_empty());
    assert_eq!(r.times.len(), r.onset_strength.len());
}
