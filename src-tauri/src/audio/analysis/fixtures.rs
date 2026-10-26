//! Representative analysis results for the summary and shaping tests (M21).
//!
//! Kept in one place so the summary coverage, the compact-shape fixtures, and the
//! headless tests all use the same sample payloads instead of repeating them.

use super::{
    AnalysisResult, GapMetric, LevelsResult, LraResult, LufsResult, MatrixResult, ModulationPeak,
    ModulationResult, NoteMetric, NoteMetricsResult, PitchResult, RhythmResult, SeriesResult,
    SpectrogramResult, SpectrumResult, WaveformResult,
};

pub(crate) fn series() -> SeriesResult {
    SeriesResult {
        sample_rate: 48_000,
        hop_size: 480,
        frames: 4,
        times: vec![0.0, 0.01, 0.02, 0.03],
        window_start: 0.0,
        values: vec![Some(1.0), None, Some(3.0), Some(2.0)],
        min_value: 1.0,
        max_value: 3.0,
        frame_size: None,
        gate: None,
    }
}

pub(crate) fn frame_rms() -> SeriesResult {
    SeriesResult {
        frame_size: Some(480),
        ..series()
    }
}

pub(crate) fn pitch() -> PitchResult {
    PitchResult {
        sample_rate: 48_000,
        hop_size: 480,
        frames: 4,
        times: vec![0.0, 0.01, 0.02, 0.03],
        window_start: 0.0,
        values: vec![Some(220.0), None, Some(440.0), Some(330.0)],
        min_value: 220.0,
        max_value: 440.0,
        effective_min_f0_hz: 50.0,
        effective_max_f0_hz: 2_000.0,
        voiced_frames: 3,
        voiced_fraction: 0.75,
        f0_reliable: false,
    }
}

pub(crate) fn matrix() -> MatrixResult {
    MatrixResult {
        sample_rate: 48_000,
        hop_size: 480,
        frames: 2,
        bins: 2,
        duration: 0.2,
        times: vec![0.0, 0.1],
        window_start: 0.0,
        bands: vec![0.0, 1.0],
        values: vec![1.0, 2.0, 3.0, 4.0],
        min_value: 1.0,
        max_value: 4.0,
    }
}

pub(crate) fn rhythm() -> RhythmResult {
    RhythmResult {
        bpm: 120.0,
        confidence: 0.8,
        hop_size: 480,
        times: vec![0.0, 0.1, 0.2],
        window_start: 0.0,
        onset_strength: vec![0.1, 0.5, 0.2],
        onset_times: vec![0.2],
        beat_times: vec![0.0, 0.5],
        downbeat_times: vec![0.0],
    }
}

pub(crate) fn spectrum() -> SpectrumResult {
    SpectrumResult {
        sample_rate: 48_000,
        fft_size: 2_048,
        hop_size: 512,
        frames: 10,
        freqs: vec![100.0, 200.0, 300.0],
        mag_db: vec![-30.0, -6.0, -20.0],
        min_db: vec![-40.0, -12.0, -30.0],
        max_db: vec![-20.0, -2.0, -10.0],
        peak_hz: 200.0,
        peak_db: -6.0,
    }
}

pub(crate) fn notes() -> NoteMetricsResult {
    NoteMetricsResult {
        window_start: 0.0,
        note_count: 1,
        gap_count: 1,
        total_gap_secs: 0.25,
        longest_gap_secs: 0.25,
        median_note_secs: 0.4,
        median_gap_secs: 0.25,
        threshold_db: -48.0,
        envelope_positions: vec![0.0, 0.5, 1.0],
        reference_note_index: Some(0),
        notes: vec![NoteMetric {
            start_secs: 0.4,
            end_secs: 0.8,
            duration_secs: 0.4,
            gap_before_secs: 0.4,
            gap_after_secs: 0.25,
            rms_db: -18.0,
            peak_db: -9.0,
            rms_db_rel_loudest: 0.0,
            peak_db_rel_loudest: 0.0,
            envelope_db: vec![-30.0, -18.0, -24.0],
            voiced_fraction: Some(0.9),
            f0_median_hz: Some(330.0),
            jitter_proxy_cents: Some(4.0),
            shimmer_proxy_db: Some(1.2),
            hnr_proxy: Some(0.8),
        }],
        gaps: vec![GapMetric {
            start_secs: 0.8,
            end_secs: 1.05,
            duration_secs: 0.25,
        }],
        syllables: None,
    }
}

pub(crate) fn modulation() -> ModulationResult {
    let peak = ModulationPeak {
        rate_hz: 6.0,
        relative_db: 0.0,
        prominence_db: 12.0,
    };
    ModulationResult {
        window_start: 0.0,
        effective_mod_min_hz: 0.5,
        effective_mod_max_hz: 100.0,
        mod_freqs: vec![0.5, 1.0, 2.0],
        am_db: vec![-3.0, -1.0, -6.0],
        fm_db: vec![-2.0, -4.0, -8.0],
        am_peaks: vec![peak.clone()],
        fm_peaks: vec![peak],
        am_depth: Some(0.5),
        am_peak_to_trough_db: Some(12.0),
        fm_run_start_secs: Some(0.2),
        fm_run_end_secs: Some(0.8),
        fm_rate_hz: Some(6.0),
        fm_peak_to_peak_cents: Some(40.0),
        fm_std_cents: Some(9.0),
        fm_reliable: true,
        voiced_fraction: 0.6,
    }
}

/// One representative result per `AnalysisResult` variant.
pub(crate) fn samples() -> Vec<AnalysisResult> {
    let waveform = WaveformResult {
        sample_rate: 48_000,
        frames: 48_000,
        duration: 1.0,
        window_start: 0.0,
        peak: 0.5,
        rms: 0.35,
        peak_db: -6.0,
        rms_db: -9.0,
        min: vec![-0.5, -0.4],
        max: vec![0.5, 0.4],
    };
    let levels = LevelsResult {
        sample_rate: 48_000,
        frames: 48_000,
        duration: 1.0,
        peak: 0.5,
        rms: 0.35,
        peak_db: -6.0,
        rms_db: -9.0,
    };
    let spectrogram = SpectrogramResult {
        sample_rate: 48_000,
        fft_size: 2_048,
        hop_size: 512,
        duration: 0.5,
        window_start: 0.0,
        frames: 2,
        bins: 2,
        freqs: vec![100.0, 200.0],
        mag_db: vec![-30.0, -6.0, -20.0, -10.0],
        min_db: -40.0,
        max_db: -6.0,
    };
    let matrix = matrix();
    let series = series();
    let pitch = pitch();
    let rhythm = rhythm();
    vec![
        AnalysisResult::Waveform(waveform),
        AnalysisResult::Levels(levels),
        AnalysisResult::FrameRms(frame_rms()),
        AnalysisResult::Spectrum(spectrum()),
        AnalysisResult::Spectrogram(spectrogram),
        AnalysisResult::MelSpectrogram(matrix.clone()),
        AnalysisResult::Mfcc(matrix.clone()),
        AnalysisResult::Chromagram(matrix.clone()),
        AnalysisResult::SpectralContrast(matrix),
        AnalysisResult::SpectralCentroid(series.clone()),
        AnalysisResult::SpectralFlux(series.clone()),
        AnalysisResult::SpectralRolloff(series.clone()),
        AnalysisResult::SpectralFlatness(series.clone()),
        AnalysisResult::SpectralBandwidth(series.clone()),
        AnalysisResult::SpectralEntropy(series.clone()),
        AnalysisResult::SpectralCrest(series.clone()),
        AnalysisResult::HarmonicRatio(series.clone()),
        AnalysisResult::ZeroCrossingRate(series.clone()),
        AnalysisResult::PitchPyin(pitch.clone()),
        AnalysisResult::PitchYin(pitch.clone()),
        AnalysisResult::PitchAutocorr(pitch),
        AnalysisResult::NoteMetrics(notes()),
        AnalysisResult::Modulation(modulation()),
        AnalysisResult::Tempo(rhythm.clone()),
        AnalysisResult::Onsets(rhythm.clone()),
        AnalysisResult::Downbeats(rhythm),
        AnalysisResult::LoudnessIntegrated(LufsResult { lufs: -23.0 }),
        AnalysisResult::LoudnessMomentary(series),
        AnalysisResult::LoudnessRange(LraResult { lra: 12.0 }),
    ]
}
