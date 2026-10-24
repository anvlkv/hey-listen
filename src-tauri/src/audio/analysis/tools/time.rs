//! Time-domain tools: the waveform envelope, the level meters, and the frame-RMS
//! amplitude envelope (M17).

use super::super::support::{build_series, db_or_floor, envelope, frame_rms, mono_buffer, seconds};
use super::super::{LevelsResult, SeriesResult, ToolOptions, WaveformResult, MAX_ENVELOPE};

/// Time-domain waveform: peak/RMS levels (via `oxiaudio`) and a min/max envelope.
pub fn waveform(mono: &[f32], sample_rate: u32) -> WaveformResult {
    let buf = mono_buffer(mono, sample_rate);
    let (min, max) = envelope(mono, MAX_ENVELOPE);
    WaveformResult {
        sample_rate,
        frames: mono.len(),
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        duration: if sample_rate > 0 {
            mono.len() as f64 / f64::from(sample_rate)
        } else {
            0.0
        },
        peak: buf.peak_amplitude(),
        rms: buf.rms_amplitude(),
        peak_db: db_or_floor(buf.peak_db()),
        rms_db: db_or_floor(buf.rms_db()),
        min,
        max,
    }
}

/// Time-domain level meters: peak / RMS in linear and dBFS.
pub fn levels(mono: &[f32], sample_rate: u32) -> LevelsResult {
    let buf = mono_buffer(mono, sample_rate);
    LevelsResult {
        sample_rate,
        frames: mono.len(),
        duration: seconds(mono.len(), sample_rate),
        peak: buf.peak_amplitude(),
        rms: buf.rms_amplitude(),
        peak_db: db_or_floor(buf.peak_db()),
        rms_db: db_or_floor(buf.rms_db()),
    }
}

/// Frame-RMS amplitude envelope (M17): one dBFS level per frame over time.
///
/// Independent of loudness measurement — no K-weighting or 400 ms blocks — so it is
/// usable on short calls. The result echoes the effective frame (samples) and hop so
/// the chart and an agent can tell what resolution they are looking at.
pub fn frame_rms_envelope(mono: &[f32], sample_rate: u32, options: &ToolOptions) -> SeriesResult {
    let (times, values, frame, hop) =
        frame_rms(mono, sample_rate, options.frame_ms(), options.hop_ms());
    let mut result = build_series(
        times,
        values.into_iter().map(Some).collect(),
        hop,
        sample_rate,
    );
    result.frame_size = Some(frame);
    result
}
