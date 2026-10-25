//! The single tool dispatcher: map a tool id to its implementation.

use super::super::support::{
    build_series, effective_hop, frame_times, mono_buffer, onset_envelope, oxi_err, pad_to_fft,
    pitch_grid, pitch_series, series_from_vec,
};
use super::super::{
    AnalysisError, AnalysisResult, LraResult, LufsResult, RhythmResult, SharedParams, ToolOptions,
    DB_FLOOR, PYIN_MAX_F0, PYIN_MIN_F0,
};
use super::{
    chromagram, frame_rms_envelope, levels, mel_spectrogram, mfcc, modulation, note_metrics,
    spectral_contrast, spectrogram, spectrum, waveform,
};

/// Dispatch a tool id to its implementation.
pub fn run(
    tool: &str,
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
        "waveform" => Ok(AnalysisResult::Waveform(waveform(mono, sample_rate))),
        "levels" => Ok(AnalysisResult::Levels(levels(mono, sample_rate))),
        "frameRms" => Ok(AnalysisResult::FrameRms(frame_rms_envelope(
            mono,
            sample_rate,
            options,
        ))),
        "spectrum" => Ok(AnalysisResult::Spectrum(spectrum(
            mono,
            sample_rate,
            params,
        )?)),
        "spectrogram" => Ok(AnalysisResult::Spectrogram(spectrogram(
            mono,
            sample_rate,
            params,
        )?)),
        "melSpectrogram" => Ok(AnalysisResult::MelSpectrogram(mel_spectrogram(
            lib_mono,
            sample_rate,
            params,
            options,
        )?)),
        "mfcc" => Ok(AnalysisResult::Mfcc(mfcc(
            lib_mono,
            sample_rate,
            params,
            options,
        )?)),
        "chromagram" => Ok(AnalysisResult::Chromagram(chromagram(
            lib_mono,
            sample_rate,
            params,
        )?)),
        "spectralContrast" => Ok(AnalysisResult::SpectralContrast(spectral_contrast(
            lib_mono,
            sample_rate,
            params,
            options,
        )?)),
        "spectralCentroid" => Ok(AnalysisResult::SpectralCentroid(series_from_vec(
            oxiaudio::dsp::spectral::spectral_centroid(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralFlux" => Ok(AnalysisResult::SpectralFlux(series_from_vec(
            oxiaudio::dsp::spectral::spectral_flux(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralRolloff" => Ok(AnalysisResult::SpectralRolloff(series_from_vec(
            oxiaudio::dsp::spectral::spectral_rolloff(
                &lib_buf(),
                fft,
                hop,
                options.rolloff_percent(),
            ),
            hop,
            sample_rate,
        ))),
        "spectralFlatness" => Ok(AnalysisResult::SpectralFlatness(series_from_vec(
            oxiaudio::dsp::spectral::spectral_flatness(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralBandwidth" => Ok(AnalysisResult::SpectralBandwidth(series_from_vec(
            oxiaudio::dsp::spectral::spectral_bandwidth(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralEntropy" => Ok(AnalysisResult::SpectralEntropy(series_from_vec(
            oxiaudio::dsp::spectral::spectral_entropy(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "spectralCrest" => Ok(AnalysisResult::SpectralCrest(series_from_vec(
            oxiaudio::dsp::spectral::spectral_crest_factor(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "harmonicRatio" => {
            let (min_f0, max_f0) = options.harmonic_range();
            Ok(AnalysisResult::HarmonicRatio(series_from_vec(
                oxiaudio::dsp::spectral::harmonic_ratio(
                    &lib_buf(),
                    pitch_fft,
                    pitch_hop,
                    min_f0,
                    max_f0,
                ),
                pitch_hop,
                sample_rate,
            )))
        }
        "zeroCrossingRate" => Ok(AnalysisResult::ZeroCrossingRate(series_from_vec(
            oxiaudio::dsp::spectral::zero_crossing_rate(&lib_buf(), fft, hop),
            hop,
            sample_rate,
        ))),
        "pitchPyin" => Ok(AnalysisResult::PitchPyin(pitch_series(
            oxiaudio::dsp::detect_pitch_pyin(&lib_buf(), pitch_fft, pitch_hop),
            pitch_hop,
            sample_rate,
            (PYIN_MIN_F0, PYIN_MAX_F0),
        ))),
        "pitchYin" => {
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
        "pitchAutocorr" => {
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
        "noteMetrics" => Ok(AnalysisResult::NoteMetrics(note_metrics(
            mono,
            sample_rate,
            options,
        ))),
        "modulation" => Ok(AnalysisResult::Modulation(modulation(
            mono,
            sample_rate,
            options,
        ))),
        "tempo" => {
            let (env_hop, onset_strength) = onset_envelope(lib_mono, sample_rate, params);
            let est = oxiaudio::dsp::estimate_tempo(&lib_buf(), fft, hop).map_err(oxi_err)?;
            Ok(AnalysisResult::Tempo(RhythmResult {
                bpm: est.bpm,
                confidence: est.confidence,
                hop_size: env_hop,
                times: frame_times(onset_strength.len(), env_hop, sample_rate),
                // Filled in by `run_window` — the tool only sees the sliced region.
                window_start: 0.0,
                onset_strength,
                onset_times: vec![],
                beat_times: est.beat_times.iter().map(|&t| t as f32).collect(),
                downbeat_times: vec![],
            }))
        }
        "onsets" => {
            let (env_hop, onset_strength) = onset_envelope(lib_mono, sample_rate, params);
            let times = oxiaudio::dsp::detect_onsets(&lib_buf(), fft, hop).map_err(oxi_err)?;
            Ok(AnalysisResult::Onsets(RhythmResult {
                bpm: 0.0,
                confidence: 0.0,
                hop_size: env_hop,
                times: frame_times(onset_strength.len(), env_hop, sample_rate),
                // Filled in by `run_window` — the tool only sees the sliced region.
                window_start: 0.0,
                onset_strength,
                onset_times: times.iter().map(|&t| t as f32).collect(),
                beat_times: vec![],
                downbeat_times: vec![],
            }))
        }
        "downbeats" => {
            let (env_hop, onset_strength) = onset_envelope(lib_mono, sample_rate, params);
            let est = oxiaudio::dsp::estimate_tempo(&lib_buf(), fft, hop).map_err(oxi_err)?;
            let downbeats = oxiaudio::dsp::detect_downbeats(
                &lib_buf(),
                &est.beat_times,
                est.bpm,
                options.bar_length(),
            );
            Ok(AnalysisResult::Downbeats(RhythmResult {
                bpm: est.bpm,
                confidence: est.confidence,
                hop_size: env_hop,
                times: frame_times(onset_strength.len(), env_hop, sample_rate),
                // Filled in by `run_window` — the tool only sees the sliced region.
                window_start: 0.0,
                onset_strength,
                onset_times: vec![],
                beat_times: est.beat_times.iter().map(|&t| t as f32).collect(),
                downbeat_times: downbeats.iter().map(|&t| t as f32).collect(),
            }))
        }
        "loudnessIntegrated" => {
            let lufs = oxiaudio::dsp::loudness_lufs(&lib_buf());
            Ok(AnalysisResult::LoudnessIntegrated(LufsResult {
                lufs: if lufs.is_finite() { lufs } else { DB_FLOOR },
            }))
        }
        "loudnessMomentary" => {
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
        "loudnessRange" => {
            let lra = oxiaudio::dsp::loudness_range(&lib_buf());
            Ok(AnalysisResult::LoudnessRange(LraResult {
                lra: if lra.is_finite() { lra } else { 0.0 },
            }))
        }
        other => Err(AnalysisError::UnknownTool(other.to_string())),
    }
}
