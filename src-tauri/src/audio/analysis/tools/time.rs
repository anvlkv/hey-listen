//! Time-domain tools: the waveform envelope and the level meters.

use super::super::support::{db_or_floor, envelope, mono_buffer, seconds};
use super::super::{LevelsResult, WaveformResult, MAX_ENVELOPE};

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
