//! The single tool dispatcher: map a tool id to its implementation.

use super::super::support::{
    build_series, effective_hop, frame_times, mono_buffer, onset_envelope, oxi_err, pad_to_fft,
    pitch_grid, pitch_series, series_from_vec,
};
use super::super::{
    AnalysisError, AnalysisResult, LraResult, LufsResult, RhythmResult, SeriesResult, SharedParams,
    ToolOptions, DB_FLOOR,
};
use super::critical_bands::critical_bands;
use super::gate::apply_gate;
use super::loudness::{loudness, specific_loudness};
use super::sharpness::sharpness;
use super::{
    chromagram, frame_rms_envelope, levels, mel_spectrogram, mfcc, modulation, note_metrics,
    spectral_contrast, spectrogram, spectrum, waveform,
};
use crate::audio::analyzers::AnalyzerId;

/// Build a scalar series and apply the window gate on `mono` (the unpadded signal).
fn gated_series(
    values: Vec<f32>,
    hop: usize,
    frame: usize,
    mono: &[f32],
    sample_rate: u32,
    options: &ToolOptions,
) -> SeriesResult {
    let mut result = series_from_vec(values, hop, sample_rate);
    result.gate = apply_gate(&mut result, mono, frame, hop, options);
    result
}
/// Build a rhythm result on the shared onset-strength grid.
#[allow(clippy::too_many_arguments)]
fn rhythm_result(
    bpm: f32,
    confidence: f32,
    onset_strength: Vec<f32>,
    env_hop: usize,
    sample_rate: u32,
    onset_times: Vec<f32>,
    beat_times: Vec<f32>,
    downbeat_times: Vec<f32>,
) -> RhythmResult {
    RhythmResult {
        bpm,
        confidence,
        hop_size: env_hop,
        times: frame_times(onset_strength.len(), env_hop, sample_rate),
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        onset_strength,
        onset_times,
        beat_times,
        downbeat_times,
    }
}

pub fn run(
    tool: AnalyzerId,
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<AnalysisResult, AnalysisError> {
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (pitch_fft, pitch_hop) = pitch_grid(mono.len(), params);
    // The library's frame-based features do not zero-pad, so feed them a padded
    // copy: a window shorter than the FFT still yields a frame. `spectrum` /
    // `spectrogram` and the time-domain / loudness tools keep the original signal.
    let padded;
    let lib_mono: &[f32] = if mono.len() < fft {
        padded = pad_to_fft(mono, fft);
        &padded
    } else {
        mono
    };
    let lib_buf = || mono_buffer(lib_mono, sample_rate);
    match tool {
        AnalyzerId::Waveform => Ok(AnalysisResult::Waveform(waveform(mono, sample_rate))),
        AnalyzerId::Levels => Ok(AnalysisResult::Levels(levels(mono, sample_rate))),
        AnalyzerId::FrameRms => Ok(AnalysisResult::FrameRms(frame_rms_envelope(
            mono,
            sample_rate,
            options,
        ))),
        AnalyzerId::Spectrum => Ok(AnalysisResult::Spectrum(spectrum(
            mono,
            sample_rate,
            params,
        )?)),
        AnalyzerId::Spectrogram => Ok(AnalysisResult::Spectrogram(spectrogram(
            mono,
            sample_rate,
            params,
        )?)),
        AnalyzerId::MelSpectrogram => Ok(AnalysisResult::MelSpectrogram(mel_spectrogram(
            lib_mono,
            sample_rate,
            params,
            options,
        )?)),
        AnalyzerId::Mfcc => Ok(AnalysisResult::Mfcc(mfcc(
            lib_mono,
            sample_rate,
            params,
            options,
        )?)),
        AnalyzerId::Chromagram => Ok(AnalysisResult::Chromagram(chromagram(
            lib_mono,
            sample_rate,
            params,
        )?)),
        AnalyzerId::SpectralContrast => Ok(AnalysisResult::SpectralContrast(spectral_contrast(
            lib_mono,
            sample_rate,
            params,
            options,
        )?)),
        AnalyzerId::CriticalBands => Ok(AnalysisResult::CriticalBands(critical_bands(
            mono,
            sample_rate,
            params,
            options,
        )?)),
        AnalyzerId::Loudness => Ok(AnalysisResult::Loudness(loudness(
            mono,
            sample_rate,
            params,
            options,
        )?)),
        AnalyzerId::SpecificLoudness => Ok(AnalysisResult::SpecificLoudness(specific_loudness(
            mono,
            sample_rate,
            params,
            options,
        )?)),
        AnalyzerId::Sharpness => Ok(AnalysisResult::Sharpness(sharpness(
            mono,
            sample_rate,
            params,
            options,
        )?)),
        AnalyzerId::SpectralCentroid => Ok(AnalysisResult::SpectralCentroid(gated_series(
            oxiaudio::dsp::spectral::spectral_centroid(&lib_buf(), fft, hop),
            hop,
            fft,
            mono,
            sample_rate,
            options,
        ))),
        AnalyzerId::SpectralFlux => Ok(AnalysisResult::SpectralFlux(series_from_vec(
            oxiaudio::dsp::spectral::spectral_flux(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        AnalyzerId::SpectralRolloff => Ok(AnalysisResult::SpectralRolloff(gated_series(
            oxiaudio::dsp::spectral::spectral_rolloff(
                &lib_buf(),
                fft,
                hop,
                options.rolloff_percent(),
            ),
            hop,
            fft,
            mono,
            sample_rate,
            options,
        ))),
        AnalyzerId::SpectralFlatness => Ok(AnalysisResult::SpectralFlatness(gated_series(
            oxiaudio::dsp::spectral::spectral_flatness(&lib_buf(), fft, hop),
            hop,
            fft,
            mono,
            sample_rate,
            options,
        ))),
        AnalyzerId::SpectralBandwidth => Ok(AnalysisResult::SpectralBandwidth(series_from_vec(
            oxiaudio::dsp::spectral::spectral_bandwidth(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        AnalyzerId::SpectralEntropy => Ok(AnalysisResult::SpectralEntropy(series_from_vec(
            oxiaudio::dsp::spectral::spectral_entropy(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        AnalyzerId::SpectralCrest => Ok(AnalysisResult::SpectralCrest(series_from_vec(
            oxiaudio::dsp::spectral::spectral_crest_factor(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        AnalyzerId::HarmonicRatio => {
            let (min_f0, max_f0) = options.harmonic_range();
            Ok(AnalysisResult::HarmonicRatio(gated_series(
                oxiaudio::dsp::spectral::harmonic_ratio(
                    &lib_buf(),
                    pitch_fft,
                    pitch_hop,
                    min_f0,
                    max_f0,
                ),
                pitch_hop,
                pitch_fft,
                mono,
                sample_rate,
                options,
            )))
        }
        AnalyzerId::ZeroCrossingRate => Ok(AnalysisResult::ZeroCrossingRate(gated_series(
            oxiaudio::dsp::spectral::zero_crossing_rate(&lib_buf(), fft, hop),
            hop,
            fft,
            mono,
            sample_rate,
            options,
        ))),
        AnalyzerId::PitchPyin => {
            let (min_f0, max_f0) = options.pyin_range();
            Ok(AnalysisResult::PitchPyin(pitch_series(
                super::super::pyin::detect(&lib_buf(), pitch_fft, pitch_hop, min_f0, max_f0),
                pitch_hop,
                sample_rate,
                (min_f0, max_f0),
            )))
        }
        AnalyzerId::PitchYin => {
            let (min_f0, max_f0) = options.yin_range();
            let frames = oxiaudio::dsp::PitchTracker::new(pitch_fft, pitch_hop)
                .with_threshold(options.yin_threshold())
                .with_range(min_f0, max_f0)
                .track(&lib_buf());
            Ok(AnalysisResult::PitchYin(pitch_series(
                frames,
                pitch_hop,
                sample_rate,
                (min_f0, max_f0),
            )))
        }
        AnalyzerId::PitchAutocorr => {
            let (min_f0, max_f0) = options.autocorr_range();
            Ok(AnalysisResult::PitchAutocorr(pitch_series(
                oxiaudio::dsp::detect_pitch_autocorr(
                    &lib_buf(),
                    pitch_fft,
                    pitch_hop,
                    min_f0,
                    max_f0,
                ),
                pitch_hop,
                sample_rate,
                (min_f0, max_f0),
            )))
        }
        AnalyzerId::NoteMetrics => Ok(AnalysisResult::NoteMetrics(note_metrics(
            mono,
            sample_rate,
            options,
        ))),
        AnalyzerId::Modulation => Ok(AnalysisResult::Modulation(modulation(
            mono,
            sample_rate,
            options,
        ))),
        AnalyzerId::Tempo => {
            let (env_hop, onset_strength) = onset_envelope(lib_mono, sample_rate, params);
            let est = oxiaudio::dsp::estimate_tempo(&lib_buf(), fft, hop).map_err(oxi_err)?;
            Ok(AnalysisResult::Tempo(rhythm_result(
                est.bpm,
                est.confidence,
                onset_strength,
                env_hop,
                sample_rate,
                vec![],
                est.beat_times.iter().map(|&t| t as f32).collect(),
                vec![],
            )))
        }
        AnalyzerId::Onsets => {
            let (env_hop, onset_strength) = onset_envelope(lib_mono, sample_rate, params);
            let times = oxiaudio::dsp::detect_onsets(&lib_buf(), fft, hop).map_err(oxi_err)?;
            Ok(AnalysisResult::Onsets(rhythm_result(
                0.0,
                0.0,
                onset_strength,
                env_hop,
                sample_rate,
                times.iter().map(|&t| t as f32).collect(),
                vec![],
                vec![],
            )))
        }
        AnalyzerId::Downbeats => {
            let (env_hop, onset_strength) = onset_envelope(lib_mono, sample_rate, params);
            let est = oxiaudio::dsp::estimate_tempo(&lib_buf(), fft, hop).map_err(oxi_err)?;
            let downbeats = oxiaudio::dsp::detect_downbeats(
                &lib_buf(),
                &est.beat_times,
                est.bpm,
                options.bar_length(),
            );
            Ok(AnalysisResult::Downbeats(rhythm_result(
                est.bpm,
                est.confidence,
                onset_strength,
                env_hop,
                sample_rate,
                vec![],
                est.beat_times.iter().map(|&t| t as f32).collect(),
                downbeats.iter().map(|&t| t as f32).collect(),
            )))
        }
        AnalyzerId::LoudnessIntegrated => {
            let lufs = oxiaudio::dsp::loudness_lufs(&lib_buf());
            Ok(AnalysisResult::LoudnessIntegrated(LufsResult {
                lufs: if lufs.is_finite() { lufs } else { DB_FLOOR },
            }))
        }
        AnalyzerId::LoudnessMomentary => {
            let buf = lib_buf();
            let (values, hop_samples) = match options.window_ms() {
                Some(ms) => (
                    oxiaudio::dsp::loudness_momentary_windowed(&buf, ms),
                    (sample_rate as u64 * ms as u64 / 1000) as usize,
                ),
                None => (
                    oxiaudio::dsp::loudness_momentary(&buf),
                    (sample_rate as usize / 10).max(1),
                ),
            };
            let times = frame_times(values.len(), hop_samples, sample_rate);
            let values = values
                .into_iter()
                .map(|value| value.is_finite().then_some(value))
                .collect();
            Ok(AnalysisResult::LoudnessMomentary(build_series(
                times,
                values,
                hop_samples,
                sample_rate,
            )))
        }
        AnalyzerId::LoudnessRange => {
            let lra = oxiaudio::dsp::loudness_range(&lib_buf());
            Ok(AnalysisResult::LoudnessRange(LraResult {
                lra: if lra.is_finite() { lra } else { 0.0 },
            }))
        }
    }
}
