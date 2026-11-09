//! Time re-basing for [`AnalysisResult`] (split out of `mod.rs` for the source-size
//! budget).

use super::{shift_times, AnalysisResult};

impl AnalysisResult {
    /// Re-base a result produced over the sliced region `[start, start + span)` onto
    /// **source seconds**: shift every time it carries by `start` and record the
    /// origin.
    ///
    /// The tools only ever see the slice, so their times begin at 0; this is the one
    /// place that knows where the window sits, and it runs before a result leaves the
    /// engine — so the GUI, the MCP server, the batch CLI and an export all speak the
    /// same absolute times as an `AnalysisWindow` / a [`super::super::super::project::Note`].
    /// Tools with no time axis (`spectrum`, the scalar readouts) are left alone.
    pub fn rebase(&mut self, start: f64) {
        let shift = start as f32;
        match self {
            AnalysisResult::Waveform(result) => result.window_start = start,
            AnalysisResult::Spectrogram(result) => result.window_start = start,
            AnalysisResult::MelSpectrogram(result)
            | AnalysisResult::Mfcc(result)
            | AnalysisResult::Chromagram(result)
            | AnalysisResult::SpectralContrast(result)
            | AnalysisResult::CriticalBands(result)
            | AnalysisResult::SpecificLoudness(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
            }
            AnalysisResult::SpectralCentroid(result)
            | AnalysisResult::SpectralFlux(result)
            | AnalysisResult::SpectralRolloff(result)
            | AnalysisResult::SpectralFlatness(result)
            | AnalysisResult::SpectralBandwidth(result)
            | AnalysisResult::SpectralEntropy(result)
            | AnalysisResult::SpectralCrest(result)
            | AnalysisResult::HarmonicRatio(result)
            | AnalysisResult::ZeroCrossingRate(result)
            | AnalysisResult::LoudnessMomentary(result)
            | AnalysisResult::FrameRms(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
            }
            AnalysisResult::Loudness(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
            }
            AnalysisResult::Sharpness(result)
            | AnalysisResult::Roughness(result)
            | AnalysisResult::FluctuationStrength(result)
            | AnalysisResult::Tonality(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
            }
            AnalysisResult::PitchPyin(result)
            | AnalysisResult::PitchYin(result)
            | AnalysisResult::PitchAutocorr(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
            }
            AnalysisResult::NoteMetrics(result) => {
                result.window_start = start;
                for note in &mut result.notes {
                    note.start_secs += shift;
                    note.end_secs += shift;
                }
                for gap in &mut result.gaps {
                    gap.start_secs += shift;
                    gap.end_secs += shift;
                }
                for syllable in result.syllables.iter_mut().flatten() {
                    syllable.start_secs += shift;
                    syllable.end_secs += shift;
                }
            }
            AnalysisResult::Modulation(result) => {
                result.window_start = start;
                if let Some(time) = &mut result.fm_run_start_secs {
                    *time += shift;
                }
                if let Some(time) = &mut result.fm_run_end_secs {
                    *time += shift;
                }
            }
            AnalysisResult::Tempo(result)
            | AnalysisResult::Onsets(result)
            | AnalysisResult::Downbeats(result) => {
                result.window_start = start;
                shift_times(&mut result.times, shift);
                shift_times(&mut result.onset_times, shift);
                shift_times(&mut result.beat_times, shift);
                shift_times(&mut result.downbeat_times, shift);
            }
            AnalysisResult::Spectrum(_)
            | AnalysisResult::Levels(_)
            | AnalysisResult::LoudnessIntegrated(_)
            | AnalysisResult::LoudnessRange(_) => {}
            // A static frequency-axis result: it has no times to shift.
            AnalysisResult::Masking(result) => result.window_start = start,
        }
    }
}
