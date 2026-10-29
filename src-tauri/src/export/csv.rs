//! The wide-matrix CSV renderer (M12).
//!
//! CSV is **data only**; provenance lives in the sidecar. The shape follows the
//! analyzer's view (`docs/exports.md` → CSV): `time_s,value` for series, a wide
//! `frames × bins` matrix for the 2D tools (rows = time frames), `key,value` for the
//! readouts, and an `events` block for the rhythm tools. The header carries the unit,
//! and numbers are written at full precision.

use crate::audio::analysis::{
    AnalysisResult, LevelsResult, LraResult, LufsResult, MatrixResult, ModulationResult,
    NoteMetricsResult, PitchResult, RhythmResult, SeriesResult, SpectrogramResult, SpectrumResult,
    WaveformResult,
};

/// Render a result as CSV. Every result kind has a shape; none falls through to an
/// empty file.
pub fn csv(result: &AnalysisResult) -> String {
    let mut out = String::new();
    match result {
        AnalysisResult::Waveform(value) => waveform(&mut out, value),
        AnalysisResult::Spectrum(value) => spectrum(&mut out, value),
        AnalysisResult::Spectrogram(value) => spectrogram(&mut out, value),
        AnalysisResult::Levels(value) => levels(&mut out, value),
        AnalysisResult::FrameRms(value)
        | AnalysisResult::SpectralCentroid(value)
        | AnalysisResult::SpectralFlux(value)
        | AnalysisResult::SpectralRolloff(value)
        | AnalysisResult::SpectralFlatness(value)
        | AnalysisResult::SpectralBandwidth(value)
        | AnalysisResult::SpectralEntropy(value)
        | AnalysisResult::SpectralCrest(value)
        | AnalysisResult::HarmonicRatio(value)
        | AnalysisResult::ZeroCrossingRate(value)
        | AnalysisResult::LoudnessMomentary(value) => series(&mut out, value),
        AnalysisResult::PitchPyin(value)
        | AnalysisResult::PitchYin(value)
        | AnalysisResult::PitchAutocorr(value) => pitch(&mut out, value),
        AnalysisResult::MelSpectrogram(value)
        | AnalysisResult::Mfcc(value)
        | AnalysisResult::Chromagram(value)
        | AnalysisResult::SpectralContrast(value) => matrix(&mut out, value),
        AnalysisResult::NoteMetrics(value) => notes(&mut out, value),
        AnalysisResult::Modulation(value) => modulation(&mut out, value),
        AnalysisResult::Tempo(value)
        | AnalysisResult::Onsets(value)
        | AnalysisResult::Downbeats(value) => rhythm(&mut out, value, result.tool_id()),
        AnalysisResult::LoudnessIntegrated(value) => lufs(&mut out, value),
        AnalysisResult::LoudnessRange(value) => lra(&mut out, value),
    }
    out
}

/// A float at full precision; non-finite values become a blank cell.
fn number(value: f32) -> String {
    if value.is_finite() {
        format!("{value}")
    } else {
        String::new()
    }
}

fn number64(value: f64) -> String {
    if value.is_finite() {
        format!("{value}")
    } else {
        String::new()
    }
}

fn optional(value: Option<f32>) -> String {
    value.map(number).unwrap_or_default()
}

/// One CSV row (without escaping: every cell is a header or a number).
fn row(out: &mut String, cells: &[String]) {
    out.push_str(&cells.join(","));
    out.push('\n');
}

/// Frame-centre time for a derived axis (`frames` evenly covering `duration`).
fn frame_time(window_start: f64, duration: f64, frames: usize, index: usize) -> String {
    let duration = if duration.is_finite() { duration } else { 0.0 };
    number64(window_start + (index as f64 + 0.5) * duration / frames.max(1) as f64)
}

fn waveform(out: &mut String, value: &WaveformResult) {
    row(out, &["time_s".into(), "min".into(), "max".into()]);
    let buckets = value.min.len().min(value.max.len());
    for index in 0..buckets {
        row(
            out,
            &[
                frame_time(value.window_start, value.duration, buckets, index),
                number(value.min[index]),
                number(value.max[index]),
            ],
        );
    }
}

fn spectrum(out: &mut String, value: &SpectrumResult) {
    row(
        out,
        &[
            "freq_hz".into(),
            "mean_db".into(),
            "min_db".into(),
            "max_db".into(),
        ],
    );
    let bins = value
        .freqs
        .len()
        .min(value.mag_db.len())
        .min(value.min_db.len())
        .min(value.max_db.len());
    for bin in 0..bins {
        row(
            out,
            &[
                number(value.freqs[bin]),
                number(value.mag_db[bin]),
                number(value.min_db[bin]),
                number(value.max_db[bin]),
            ],
        );
    }
}

fn spectrogram(out: &mut String, value: &SpectrogramResult) {
    let mut header = vec!["time_s".to_string()];
    header.extend(value.freqs.iter().map(|freq| number(*freq)));
    row(out, &header);
    for frame in 0..value.frames {
        let mut cells = Vec::with_capacity(value.bins + 1);
        cells.push(frame_time(
            value.window_start,
            value.duration,
            value.frames,
            frame,
        ));
        let start = frame * value.bins;
        for bin in 0..value.bins {
            cells.push(number(
                value.mag_db.get(start + bin).copied().unwrap_or(f32::NAN),
            ));
        }
        row(out, &cells);
    }
}

fn series(out: &mut String, value: &SeriesResult) {
    row(out, &["time_s".into(), "value".into()]);
    for (time, measured) in value.times.iter().zip(value.values.iter()) {
        row(out, &[number(*time), optional(*measured)]);
    }
}

fn pitch(out: &mut String, value: &PitchResult) {
    row(out, &["time_s".into(), "f0_hz".into()]);
    for (time, measured) in value.times.iter().zip(value.values.iter()) {
        row(out, &[number(*time), optional(*measured)]);
    }
}

fn matrix(out: &mut String, value: &MatrixResult) {
    let mut header = vec!["time_s".to_string()];
    if value.bands.len() == value.bins {
        header.extend(value.bands.iter().map(|band| number(*band)));
    } else {
        header.extend((0..value.bins).map(|bin| bin.to_string()));
    }
    row(out, &header);
    for frame in 0..value.frames {
        let mut cells = Vec::with_capacity(value.bins + 1);
        cells.push(number(value.times.get(frame).copied().unwrap_or(f32::NAN)));
        let start = frame * value.bins;
        for bin in 0..value.bins {
            cells.push(number(
                value.values.get(start + bin).copied().unwrap_or(f32::NAN),
            ));
        }
        row(out, &cells);
    }
}

fn levels(out: &mut String, value: &LevelsResult) {
    row(out, &["key".into(), "value".into()]);
    for (key, measured) in [
        ("peak", value.peak),
        ("rms", value.rms),
        ("peak_db", value.peak_db),
        ("rms_db", value.rms_db),
    ] {
        row(out, &[key.into(), number(measured)]);
    }
}

fn lufs(out: &mut String, value: &LufsResult) {
    row(out, &["key".into(), "value".into()]);
    row(out, &["lufs".into(), number(value.lufs)]);
}

fn lra(out: &mut String, value: &LraResult) {
    row(out, &["key".into(), "value".into()]);
    row(out, &["lra_lu".into(), number(value.lra)]);
}

fn notes(out: &mut String, value: &NoteMetricsResult) {
    row(
        out,
        &[
            "start_s".into(),
            "end_s".into(),
            "duration_s".into(),
            "gap_before_s".into(),
            "gap_after_s".into(),
            "rms_db".into(),
            "peak_db".into(),
            "rms_db_rel_loudest".into(),
            "peak_db_rel_loudest".into(),
            "voiced_fraction".into(),
            "f0_median_hz".into(),
            "jitter_proxy_cents".into(),
            "shimmer_proxy_db".into(),
            "hnr_proxy".into(),
            "envelope_db".into(),
        ],
    );
    for note in &value.notes {
        row(
            out,
            &[
                number(note.start_secs),
                number(note.end_secs),
                number(note.duration_secs),
                number(note.gap_before_secs),
                number(note.gap_after_secs),
                number(note.rms_db),
                number(note.peak_db),
                number(note.rms_db_rel_loudest),
                number(note.peak_db_rel_loudest),
                optional(note.voiced_fraction),
                optional(note.f0_median_hz),
                optional(note.jitter_proxy_cents),
                optional(note.shimmer_proxy_db),
                optional(note.hnr_proxy),
                // The envelope samples share `envelopePositions`, so one cell of
                // `|`-joined values keeps the row flat (no commas inside a cell).
                note.envelope_db
                    .iter()
                    .map(|value| number(*value))
                    .collect::<Vec<_>>()
                    .join("|"),
            ],
        );
    }
}

fn modulation(out: &mut String, value: &ModulationResult) {
    row(out, &["rate_hz".into(), "am_db".into(), "fm_db".into()]);
    for (index, rate) in value.mod_freqs.iter().enumerate() {
        row(
            out,
            &[
                number(*rate),
                optional(value.am_db.get(index).copied()),
                optional(value.fm_db.get(index).copied()),
            ],
        );
    }
}

fn rhythm(out: &mut String, value: &RhythmResult, tool: &str) {
    row(out, &["time_s".into(), "onset_strength".into()]);
    for (time, strength) in value.times.iter().zip(value.onset_strength.iter()) {
        row(out, &[number(*time), number(*strength)]);
    }
    let (times, kind) = match tool {
        "tempo" => (&value.beat_times, "beat"),
        "downbeats" => (&value.downbeat_times, "downbeat"),
        _ => (&value.onset_times, "onset"),
    };
    out.push('\n');
    row(out, &["time_s".into(), "type".into()]);
    for time in times {
        row(out, &[number(*time), kind.into()]);
    }
}
