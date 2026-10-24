//! Per-note voice-quality **proxies** (M19): jitter, shimmer, and HNR over the M18
//! note segments.
//!
//! They are proxies, not clinical measures: jitter is the spread of a detrended YIN f0
//! track in cents, shimmer is the spread of the note's frame RMS in dB, and the HNR
//! proxy is `oxiaudio`'s 0–1 autocorrelation periodicity — not HNR in dB. See
//! `docs/analysis-metrics.md` → M19.

use oxiaudio::dsp::spectral::harmonic_ratio;

use super::super::support::mono_buffer;
use super::super::ToolOptions;
use super::notes::{median, Segment};
use super::pitch_track::{pad_to, pitch_track};

/// Below this many voiced pitch frames the pitch-derived proxies are `None` (a linear
/// detrend plus a standard deviation needs a few points to say anything).
const MIN_VOICED_FRAMES: usize = 4;
/// Below this many harmonic-ratio frames the HNR proxy is `None`.
const MIN_HNR_FRAMES: usize = 2;
/// Below this many frame-RMS values the shimmer proxy is `None`.
const MIN_SHIMMER_FRAMES: usize = 2;

/// A note's quality proxies; each is `None` when the note has too little material.
pub(super) struct Proxies {
    pub voiced_fraction: Option<f32>,
    pub f0_median_hz: Option<f32>,
    pub jitter_proxy_cents: Option<f32>,
    pub shimmer_proxy_db: Option<f32>,
    pub hnr_proxy: Option<f32>,
}

/// Measure the proxies for one note. `times` / `levels` are the window's RMS envelope,
/// used for shimmer and to bound the frames; pitch and periodicity use the note slice's
/// own fine grid.
pub(super) fn proxies(
    mono: &[f32],
    sample_rate: u32,
    segment: Segment,
    options: &ToolOptions,
    times: &[f32],
    levels: &[f32],
) -> Proxies {
    let slice = segment_slice(mono, sample_rate, segment);
    let range = options.note_pitch_range();
    let (frames, frame, hop) = pitch_track(
        &slice,
        sample_rate,
        options.pitch_frame_ms(),
        options.pitch_hop_ms(),
        range,
    );
    let voiced: Vec<f32> = frames
        .iter()
        .filter(|frame| frame.is_voiced && frame.frequency_hz > 0.0)
        .map(|frame| frame.frequency_hz)
        .collect();

    let voiced_fraction = (!frames.is_empty()).then(|| voiced.len() as f32 / frames.len() as f32);
    let f0_median_hz = (!voiced.is_empty()).then(|| median(&voiced));
    let jitter_proxy_cents = (voiced.len() >= MIN_VOICED_FRAMES).then(|| jitter_cents(&voiced));

    let note_levels = levels_within(times, levels, segment);
    let shimmer_proxy_db =
        (note_levels.len() >= MIN_SHIMMER_FRAMES).then(|| population_std(&note_levels));

    Proxies {
        voiced_fraction,
        f0_median_hz,
        jitter_proxy_cents,
        shimmer_proxy_db,
        hnr_proxy: hnr(&slice, sample_rate, frame, hop, range),
    }
}

/// The samples covering `[start, end)` of the window.
fn segment_slice(mono: &[f32], sample_rate: u32, segment: Segment) -> Vec<f32> {
    let rate = sample_rate.max(1) as f32;
    let first = ((segment.start * rate).floor() as usize).min(mono.len());
    let last = ((segment.end * rate).ceil() as usize)
        .min(mono.len())
        .max(first);
    mono[first..last].to_vec()
}

/// The window's frame-RMS levels whose centres fall inside the note.
fn levels_within(times: &[f32], levels: &[f32], segment: Segment) -> Vec<f32> {
    times
        .iter()
        .zip(levels)
        .filter(|(time, _)| **time >= segment.start && **time <= segment.end)
        .map(|(_, &db)| db)
        .collect()
}

/// Jitter proxy: convert the voiced f0 track to cents around its median, remove the
/// linear trend, and take the population standard deviation of the residual.
fn jitter_cents(f0s: &[f32]) -> f32 {
    let reference = median(f0s);
    let cents: Vec<f32> = f0s
        .iter()
        .map(|&f0| 1_200.0 * (f0 / reference).log2())
        .collect();
    detrended_std(&cents)
}

/// Mean 0–1 autocorrelation periodicity over the note (the HNR proxy).
fn hnr(
    slice: &[f32],
    sample_rate: u32,
    frame: usize,
    hop: usize,
    range: (f32, f32),
) -> Option<f32> {
    let padded = pad_to(slice, frame);
    let buf = mono_buffer(&padded, sample_rate);
    let ratios: Vec<f32> = harmonic_ratio(&buf, frame, hop, range.0, range.1)
        .into_iter()
        .filter(|value| value.is_finite())
        .collect();
    if ratios.len() < MIN_HNR_FRAMES {
        return None;
    }
    let mean = ratios.iter().sum::<f32>() / ratios.len() as f32;
    Some(mean.clamp(0.0, 1.0))
}

/// Population standard deviation (the whole note is the population).
fn population_std(values: &[f32]) -> f32 {
    let count = values.len();
    if count == 0 {
        return 0.0;
    }
    let mean = values.iter().sum::<f32>() / count as f32;
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f32>()
        / count as f32;
    variance.sqrt()
}

/// Population standard deviation of the residuals after removing a least-squares line
/// fitted against the sample index.
fn detrended_std(values: &[f32]) -> f32 {
    let count = values.len();
    if count < 2 {
        return 0.0;
    }
    let mean_x = (count - 1) as f32 / 2.0;
    let mean_y = values.iter().sum::<f32>() / count as f32;
    let (mut numerator, mut denominator) = (0.0f32, 0.0f32);
    for (index, &value) in values.iter().enumerate() {
        let dx = index as f32 - mean_x;
        numerator += dx * (value - mean_y);
        denominator += dx * dx;
    }
    let slope = if denominator > 0.0 {
        numerator / denominator
    } else {
        0.0
    };
    let residuals: Vec<f32> = values
        .iter()
        .enumerate()
        .map(|(index, &value)| value - (mean_y + slope * (index as f32 - mean_x)))
        .collect();
    population_std(&residuals)
}
