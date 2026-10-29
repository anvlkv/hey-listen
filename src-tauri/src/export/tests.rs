//! CSV shape and envelope tests (M12): every result family, the wide matrix, the
//! sidecar, and file naming.

use serde_json::json;

use crate::audio::analysis::{
    AnalysisResult, LevelsResult, MatrixResult, ModulationResult, NoteMetric, NoteMetricsResult,
    RhythmResult, SeriesResult, SpectrogramResult, SpectrumResult,
};
use crate::project::AnalysisWindow;

use super::{envelope, ExportContext, ExportFormat, ExportSource};

fn series() -> SeriesResult {
    SeriesResult {
        sample_rate: 48_000,
        hop_size: 128,
        frames: 3,
        times: vec![0.0, 0.5, 1.0],
        window_start: 0.0,
        values: vec![Some(-20.0), None, Some(-30.5)],
        min_value: -30.5,
        max_value: -20.0,
        frame_size: Some(512),
        gate: None,
    }
}

fn context() -> ExportContext {
    ExportContext {
        tool: "spectrum".to_string(),
        source: ExportSource {
            name: "mix.wav".to_string(),
            kind: "file".to_string(),
            sample_rate: 48_000,
            channels: 2,
            duration: 12.5,
            path: Some("/tmp/mix.wav".to_string()),
        },
        window: AnalysisWindow {
            start_secs: 2.0,
            end_secs: 4.0,
        },
        params: Default::default(),
        options: json!({ "nMels": 40 })
            .as_object()
            .cloned()
            .unwrap_or_default(),
    }
}

#[test]
fn series_is_time_and_value_with_a_gap() {
    let text = super::csv::csv(&AnalysisResult::SpectralCentroid(series()));
    assert_eq!(text.lines().next(), Some("time_s,value"));
    assert!(text.contains("0.5,\n"), "{text}");
    assert!(text.contains("1,-30.5\n"), "{text}");
}

#[test]
fn spectrum_is_one_row_per_bin_with_its_units() {
    let result = AnalysisResult::Spectrum(SpectrumResult {
        sample_rate: 48_000,
        fft_size: 2048,
        hop_size: 512,
        frames: 2,
        freqs: vec![100.0, 200.0],
        mag_db: vec![-10.0, -20.0],
        min_db: vec![-12.0, -24.0],
        max_db: vec![-8.0, -16.0],
        peak_hz: 100.0,
        peak_db: -8.0,
    });
    let text = super::csv::csv(&result);
    assert_eq!(text.lines().next(), Some("freq_hz,mean_db,min_db,max_db"));
    assert!(text.contains("100,-10,-12,-8\n"), "{text}");
}

#[test]
fn spectrogram_is_a_wide_matrix_with_frequency_headers() {
    let result = AnalysisResult::Spectrogram(SpectrogramResult {
        sample_rate: 48_000,
        fft_size: 1024,
        hop_size: 256,
        duration: 1.0,
        window_start: 10.0,
        frames: 2,
        bins: 3,
        freqs: vec![100.0, 200.0, 300.0],
        mag_db: vec![-1.0, -2.0, -3.0, -4.0, -5.0, -6.0],
        min_db: -6.0,
        max_db: -1.0,
    });
    let text = super::csv::csv(&result);
    assert_eq!(text.lines().next(), Some("time_s,100,200,300"));
    // Frame centres: 10 + 0.25, 10 + 0.75.
    assert!(text.contains("10.25,-1,-2,-3\n"), "{text}");
    assert!(text.contains("10.75,-4,-5,-6\n"), "{text}");
}

#[test]
fn matrix_uses_band_indices_when_the_axis_is_not_hz() {
    let result = AnalysisResult::Mfcc(MatrixResult {
        sample_rate: 48_000,
        hop_size: 128,
        frames: 2,
        bins: 2,
        duration: 1.0,
        times: vec![0.1, 0.6],
        window_start: 0.0,
        bands: vec![0.0, 1.0],
        values: vec![1.0, 2.0, 3.0, 4.0],
        min_value: 1.0,
        max_value: 4.0,
    });
    let text = super::csv::csv(&result);
    assert_eq!(text.lines().next(), Some("time_s,0,1"));
    assert!(text.contains("0.1,1,2\n"), "{text}");
}

#[test]
fn readouts_are_key_value_pairs() {
    let result = AnalysisResult::Levels(LevelsResult {
        sample_rate: 48_000,
        frames: 48_000,
        duration: 1.0,
        peak: 0.5,
        rms: 0.25,
        peak_db: -6.0,
        rms_db: -12.0,
    });
    let text = super::csv::csv(&result);
    assert_eq!(text.lines().next(), Some("key,value"));
    assert!(text.contains("peak_db,-6\n"), "{text}");
    assert!(text.contains("rms_db,-12\n"), "{text}");
}

#[test]
fn rhythm_writes_the_envelope_then_its_events() {
    let result = AnalysisResult::Tempo(RhythmResult {
        bpm: 120.0,
        confidence: 0.8,
        hop_size: 512,
        times: vec![0.0, 0.5],
        window_start: 0.0,
        onset_strength: vec![0.1, 0.9],
        onset_times: vec![0.5],
        beat_times: vec![0.0, 0.5],
        downbeat_times: vec![0.0],
    });
    let text = super::csv::csv(&result);
    assert!(
        text.starts_with("time_s,onset_strength\n0,0.1\n0.5,0.9\n\n"),
        "{text}"
    );
    assert!(text.contains("time_s,type\n0,beat\n0.5,beat\n"), "{text}");
}

#[test]
fn notes_are_one_row_per_detected_note() {
    let result = AnalysisResult::NoteMetrics(NoteMetricsResult {
        window_start: 0.0,
        note_count: 1,
        gap_count: 0,
        total_gap_secs: 0.0,
        longest_gap_secs: 0.0,
        median_note_secs: 0.2,
        median_gap_secs: 0.0,
        threshold_db: -50.0,
        envelope_positions: vec![0.0, 0.5, 1.0],
        reference_note_index: Some(0),
        notes: vec![NoteMetric {
            start_secs: 0.1,
            end_secs: 0.3,
            duration_secs: 0.2,
            gap_before_secs: 0.1,
            gap_after_secs: 0.1,
            rms_db: -20.0,
            peak_db: -10.0,
            rms_db_rel_loudest: 0.0,
            peak_db_rel_loudest: 0.0,
            envelope_db: vec![-30.0, -20.0, -25.0],
            voiced_fraction: Some(0.9),
            f0_median_hz: Some(440.0),
            jitter_proxy_cents: None,
            shimmer_proxy_db: Some(1.5),
            hnr_proxy: Some(0.8),
        }],
        gaps: Vec::new(),
        syllables: None,
    });
    let text = super::csv::csv(&result);
    assert!(text
        .lines()
        .next()
        .is_some_and(|header| header.starts_with("start_s,end_s,duration_s")));
    assert!(
        text.contains("0.1,0.3,0.2,0.1,0.1,-20,-10,0,0,0.9,440,,1.5,0.8,-30|-20|-25\n"),
        "{text}"
    );
}

#[test]
fn modulation_shares_one_rate_axis() {
    let result = AnalysisResult::Modulation(ModulationResult {
        window_start: 0.0,
        effective_mod_min_hz: 0.5,
        effective_mod_max_hz: 20.0,
        mod_freqs: vec![1.0, 2.0],
        am_db: vec![0.0, -6.0],
        fm_db: vec![-3.0, -9.0],
        am_peaks: Vec::new(),
        fm_peaks: Vec::new(),
        am_depth: None,
        am_peak_to_trough_db: None,
        fm_run_start_secs: None,
        fm_run_end_secs: None,
        fm_rate_hz: None,
        fm_peak_to_peak_cents: None,
        fm_std_cents: None,
        fm_reliable: false,
        voiced_fraction: 0.0,
    });
    let text = super::csv::csv(&result);
    assert_eq!(text.lines().next(), Some("rate_hz,am_db,fm_db"));
    assert!(text.contains("2,-6,-9\n"), "{text}");
}

#[test]
fn the_envelope_carries_provenance_and_the_typed_result() {
    let result = AnalysisResult::SpectralCentroid(series());
    let value = envelope::envelope(&context(), &result, 1_730_000_000_000);
    assert_eq!(value["kind"], envelope::KIND);
    assert_eq!(value["formatVersion"], envelope::FORMAT_VERSION);
    assert_eq!(value["tool"], "spectrum");
    assert_eq!(value["generatedAt"], 1_730_000_000_000u64);
    assert_eq!(value["source"]["name"], "mix.wav");
    assert_eq!(value["source"]["path"], "/tmp/mix.wav");
    assert_eq!(value["window"]["startSecs"], 2.0);
    assert_eq!(value["window"]["endSecs"], 4.0);
    assert_eq!(value["options"]["nMels"], 40);
    assert_eq!(value["result"]["tool"], "spectralCentroid");
    assert_eq!(value["result"]["frames"], 3);
}

#[test]
fn csv_exports_a_sidecar_without_the_result() {
    let rendered = envelope::render(
        &context(),
        &AnalysisResult::SpectralCentroid(series()),
        ExportFormat::Csv,
        42,
    );
    assert_eq!(rendered.file_name, "mix.spectrum.csv");
    let sidecar = rendered.sidecar.expect("CSV carries a sidecar");
    assert!(sidecar.contains("\"tool\": \"spectrum\""), "{sidecar}");
    assert!(!sidecar.contains("\"result\""), "{sidecar}");
    assert!(rendered.text.starts_with("time_s,value\n"));
}

#[test]
fn json_exports_the_envelope_and_no_sidecar() {
    let rendered = envelope::render(
        &context(),
        &AnalysisResult::SpectralCentroid(series()),
        ExportFormat::Json,
        42,
    );
    assert_eq!(rendered.file_name, "mix.spectrum.json");
    assert!(rendered.sidecar.is_none());
    assert!(rendered.text.contains("\"kind\": \"hey-listen.analysis\""));
}

#[test]
fn file_names_are_stripped_and_sanitized() {
    assert_eq!(
        envelope::file_name("dawn call.wav", "noteMetrics", ExportFormat::Csv),
        "dawn_call.noteMetrics.csv"
    );
    assert_eq!(
        envelope::file_name("dir/mix.wav", "levels", ExportFormat::Json),
        "mix.levels.json"
    );
    assert_eq!(
        envelope::file_name("", "levels", ExportFormat::Json),
        "export.levels.json"
    );
}
