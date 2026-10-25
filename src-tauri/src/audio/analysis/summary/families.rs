//! Per-result-family summary content (M21).
//!
//! One arm per [`AnalysisResult`] family. Each arm pushes the items that family
//! reports, in the order `summary_keys` (see [`super::keys`]) documents, so an agent can
//! discover the keys with `get_analyzer` and read the values without inspecting arrays.
//! Optional items (a peak that does not exist, a loudest note in an empty result) are
//! simply absent.

use super::super::shape::{flat_peak, matrix_peak, spectrogram_peak};
use super::SummaryBuilder;
use crate::audio::analysis::{
    AnalysisResult, MatrixResult, ModulationResult, NoteMetricsResult, PitchResult, RhythmResult,
    SeriesResult, SpectrogramResult, SpectrumResult, WaveformResult,
};

pub(super) fn summarize(result: &AnalysisResult) -> super::ResultSummary {
    let tool = result.tool_id();
    let label = crate::audio::analyzers::title(tool).unwrap_or(tool);
    let mut b = SummaryBuilder::new(tool, label);
    match result {
        AnalysisResult::Waveform(r) => waveform(&mut b, r),
        AnalysisResult::Levels(r) => {
            b.push("peakDb", "peak", f64::from(r.peak_db), Some("dBFS"));
            b.push("rmsDb", "RMS", f64::from(r.rms_db), Some("dBFS"));
            b.push("duration", "duration", r.duration, Some("s"));
        }
        AnalysisResult::Spectrum(r) => spectrum(&mut b, r),
        AnalysisResult::Spectrogram(r) => spectrogram(&mut b, r),
        AnalysisResult::MelSpectrogram(r)
        | AnalysisResult::Mfcc(r)
        | AnalysisResult::Chromagram(r)
        | AnalysisResult::SpectralContrast(r) => matrix(&mut b, tool, r),
        AnalysisResult::FrameRms(r) => frame_rms(&mut b, r),
        AnalysisResult::PitchPyin(r)
        | AnalysisResult::PitchYin(r)
        | AnalysisResult::PitchAutocorr(r) => pitch(&mut b, r),
        AnalysisResult::NoteMetrics(r) => notes(&mut b, r),
        AnalysisResult::Modulation(r) => modulation(&mut b, r),
        AnalysisResult::Tempo(r) | AnalysisResult::Onsets(r) | AnalysisResult::Downbeats(r) => {
            rhythm(&mut b, r)
        }
        AnalysisResult::LoudnessIntegrated(r) => {
            b.push("lufs", "loudness", f64::from(r.lufs), Some("LUFS"));
        }
        AnalysisResult::LoudnessRange(r) => {
            b.push("lra", "range", f64::from(r.lra), Some("LU"));
        }
        other => {
            if let Some(r) = other.series() {
                series(&mut b, tool, r);
            }
        }
    }
    b.finish()
}

fn waveform(b: &mut SummaryBuilder, r: &WaveformResult) {
    b.push("peakDb", "peak", f64::from(r.peak_db), Some("dBFS"));
    b.push("rmsDb", "RMS", f64::from(r.rms_db), Some("dBFS"));
    b.push("duration", "duration", r.duration, Some("s"));
}

fn spectrum(b: &mut SummaryBuilder, r: &SpectrumResult) {
    b.push("peakHz", "peak", f64::from(r.peak_hz), Some("Hz"));
    b.push("peakDb", "level", f64::from(r.peak_db), Some("dBFS"));
    b.count("fftSize", "FFT size", r.fft_size);
    b.count("hopSize", "hop", r.hop_size);
    b.count("frames", "frames", r.frames);
}

fn spectrogram(b: &mut SummaryBuilder, r: &SpectrogramResult) {
    b.count("frames", "frames", r.frames);
    b.count("bins", "bins", r.bins);
    b.push("duration", "duration", r.duration, Some("s"));
    if let Some((_, bin, time, level)) = spectrogram_peak(r) {
        b.push("peakTime", "peak at", time, Some("s"));
        if let Some(hz) = r.freqs.get(bin) {
            b.push("peakHz", "peak frequency", f64::from(*hz), Some("Hz"));
        }
        b.push("peakDb", "peak level", f64::from(level), Some("dBFS"));
    }
}

fn matrix(b: &mut SummaryBuilder, tool: &str, r: &MatrixResult) {
    b.count("frames", "frames", r.frames);
    b.count("bands", "bands", r.bins);
    b.push("duration", "duration", f64::from(r.duration), Some("s"));
    if let Some((frame, band, value)) = matrix_peak(r) {
        b.count("peakFrame", "peak frame", frame);
        b.count("peakBand", "peak band", band);
        let unit = match tool {
            "melSpectrogram" | "spectralContrast" => Some("dB"),
            _ => None,
        };
        b.push("peakValue", "peak value", f64::from(value), unit);
        if let Some(time) = r.times.get(frame) {
            b.push("peakTime", "peak at", f64::from(*time), Some("s"));
        }
    }
}

fn frame_rms(b: &mut SummaryBuilder, r: &SeriesResult) {
    let present: Vec<f64> = r.values.iter().flatten().map(|v| f64::from(*v)).collect();
    if let Some(min) = present.iter().copied().reduce(f64::min) {
        b.push("minDb", "min", min, Some("dBFS"));
    }
    if let Some(max) = present.iter().copied().reduce(f64::max) {
        b.push("maxDb", "max", max, Some("dBFS"));
    }
    if !present.is_empty() {
        let mean = present.iter().sum::<f64>() / present.len() as f64;
        b.push("meanDb", "mean", mean, Some("dBFS"));
    }
    if let Some(frame) = r.frame_size {
        b.count("frameSize", "frame", frame);
    }
    b.count("hopSize", "hop", r.hop_size);
    b.count("frames", "frames", r.frames);
}

/// Every scalar-per-frame tool. The unit comes from the tool, so an agent never has to
/// infer Hz vs LUFS from the numbers.
fn series(b: &mut SummaryBuilder, tool: &str, r: &SeriesResult) {
    let unit = match tool {
        "spectralCentroid" | "spectralRolloff" | "spectralBandwidth" => Some("Hz"),
        "loudnessMomentary" => Some("LUFS"),
        _ => None,
    };
    b.count("frames", "frames", r.frames);
    let mut min: Option<(f64, f64)> = None;
    let mut max: Option<(f64, f64)> = None;
    for (index, value) in r.values.iter().enumerate() {
        let Some(value) = value else { continue };
        let value = f64::from(*value);
        let time = r.times.get(index).map_or(0.0, |t| f64::from(*t));
        if min.is_none_or(|(current, _)| value < current) {
            min = Some((value, time));
        }
        if max.is_none_or(|(current, _)| value > current) {
            max = Some((value, time));
        }
    }
    if let Some((value, _)) = min {
        b.push("min", "min", value, unit);
    }
    if let Some((value, _)) = max {
        b.push("max", "max", value, unit);
    }
    if let Some((_, time)) = min {
        b.push("minTime", "at", time, Some("s"));
    }
    if let Some((_, time)) = max {
        b.push("maxTime", "at", time, Some("s"));
    }
}

fn pitch(b: &mut SummaryBuilder, r: &PitchResult) {
    b.count("frames", "frames", r.frames);
    let present: Vec<f64> = r.values.iter().flatten().map(|v| f64::from(*v)).collect();
    if let Some(median) = median(&present) {
        b.push("medianF0Hz", "median f0", median, Some("Hz"));
    }
    if !present.is_empty() {
        let mean = present.iter().sum::<f64>() / present.len() as f64;
        b.push("meanF0Hz", "mean f0", mean, Some("Hz"));
    }
    b.push(
        "voicedFraction",
        "voiced",
        f64::from(r.voiced_fraction) * 100.0,
        Some("%"),
    );
    b.push(
        "effectiveMinF0Hz",
        "f0 from",
        f64::from(r.effective_min_f0_hz),
        Some("Hz"),
    );
    b.push(
        "effectiveMaxF0Hz",
        "f0 to",
        f64::from(r.effective_max_f0_hz),
        Some("Hz"),
    );
}

fn rhythm(b: &mut SummaryBuilder, r: &RhythmResult) {
    b.push("bpm", "tempo", f64::from(r.bpm), Some("BPM"));
    b.push(
        "confidence",
        "confidence",
        f64::from(r.confidence) * 100.0,
        Some("%"),
    );
    b.count("onsetCount", "onsets", r.onset_times.len());
    b.count("beatCount", "beats", r.beat_times.len());
    b.count("downbeatCount", "downbeats", r.downbeat_times.len());
    let events = r
        .onset_times
        .iter()
        .chain(&r.beat_times)
        .chain(&r.downbeat_times)
        .map(|t| f64::from(*t));
    let (mut first, mut last) = (f64::INFINITY, f64::NEG_INFINITY);
    for event in events {
        first = first.min(event);
        last = last.max(event);
    }
    if first.is_finite() {
        b.push("firstEvent", "first event", first, Some("s"));
        b.push("lastEvent", "last event", last, Some("s"));
    }
    if let Some((index, _)) = flat_peak(&r.onset_strength) {
        if let Some(time) = r.times.get(index) {
            b.push(
                "strongestOnset",
                "strongest onset",
                f64::from(*time),
                Some("s"),
            );
        }
    }
}

fn notes(b: &mut SummaryBuilder, r: &NoteMetricsResult) {
    b.count("noteCount", "notes", r.note_count);
    b.count("gapCount", "gaps", r.gap_count);
    b.push(
        "totalGap",
        "total gap",
        f64::from(r.total_gap_secs),
        Some("s"),
    );
    b.push(
        "longestGap",
        "longest gap",
        f64::from(r.longest_gap_secs),
        Some("s"),
    );
    b.push(
        "medianNote",
        "median note",
        f64::from(r.median_note_secs),
        Some("s"),
    );
    b.push(
        "thresholdDb",
        "gate",
        f64::from(r.threshold_db),
        Some("dBFS"),
    );
    if let Some(note) = r.reference_note_index.and_then(|index| r.notes.get(index)) {
        b.push(
            "loudestNoteDb",
            "loudest note",
            f64::from(note.rms_db),
            Some("dBFS"),
        );
        b.push(
            "loudestNoteTime",
            "at",
            f64::from(note.start_secs),
            Some("s"),
        );
    }
}

fn modulation(b: &mut SummaryBuilder, r: &ModulationResult) {
    if let Some(peak) = r.am_peaks.first() {
        b.push("amRateHz", "AM rate", f64::from(peak.rate_hz), Some("Hz"));
    }
    if let Some(depth) = r.am_depth {
        b.push("amDepth", "AM depth", f64::from(depth) * 100.0, Some("%"));
    }
    if let Some(range) = r.am_peak_to_trough_db {
        b.push(
            "amPeakToTroughDb",
            "AM peak-to-trough",
            f64::from(range),
            Some("dB"),
        );
    }
    if let Some(rate) = r.fm_rate_hz {
        b.push("fmRateHz", "FM rate", f64::from(rate), Some("Hz"));
    }
    if let Some(cents) = r.fm_peak_to_peak_cents {
        b.push(
            "fmPeakToPeakCents",
            "FM peak-to-peak",
            f64::from(cents),
            Some("cents"),
        );
    }
    if let (Some(start), Some(end)) = (r.fm_run_start_secs, r.fm_run_end_secs) {
        b.push("fmRunSecs", "FM run", f64::from(end - start), Some("s"));
    }
    b.push(
        "voicedFraction",
        "voiced",
        f64::from(r.voiced_fraction) * 100.0,
        Some("%"),
    );
}

fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let mid = sorted.len() / 2;
    Some(if sorted.len().is_multiple_of(2) {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    })
}
