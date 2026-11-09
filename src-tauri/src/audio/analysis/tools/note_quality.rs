//! Per-note voice-quality **proxies** (M19): jitter, shimmer, and HNR over the M18
//! note segments.
//!
//! They are proxies, not clinical measures: jitter is the spread of a YIN f0 track
//! detrended over its frame times, in cents; shimmer is the spread of the note's frame
//! RMS in dB; and the HNR proxy is `oxiaudio`'s 0–1 autocorrelation periodicity — not
//! HNR in dB. See `docs/analysis-metrics.md` → M19.

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
    let voiced: Vec<(f64, f32)> = frames
        .iter()
        .filter(|frame| frame.is_voiced && frame.frequency_hz > 0.0)
        .map(|frame| (frame.time_seconds, frame.frequency_hz))
        .collect();

    let voiced_fraction = (!frames.is_empty()).then(|| voiced.len() as f32 / frames.len() as f32);
    let f0s: Vec<f32> = voiced.iter().map(|(_, f0)| *f0).collect();
    let f0_median_hz = (!f0s.is_empty()).then(|| median(&f0s));
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
/// least-squares trend **over the retained frames' actual times**, and take the
/// population standard deviation of the residual. Measuring against the compacted frame
/// index instead would read an irregular voicing pattern (e.g. a gap in the middle) as a
/// trend in pitch.
fn jitter_cents(pitches: &[(f64, f32)]) -> f32 {
    let f0s: Vec<f32> = pitches.iter().map(|(_, f0)| *f0).collect();
    let reference = median(&f0s);
    let start = pitches.first().map_or(0.0, |(time, _)| *time);
    let points: Vec<(f32, f32)> = pitches
        .iter()
        .map(|(time, f0)| {
            let cents = 1_200.0 * (f0 / reference).log2();
            ((time - start) as f32, cents)
        })
        .collect();
    detrended_std(&points)
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
/// fitted against each point's own time `x` (seconds).
fn detrended_std(points: &[(f32, f32)]) -> f32 {
    let count = points.len();
    if count < 2 {
        return 0.0;
    }
    let mean_x = points.iter().map(|&(x, _)| x).sum::<f32>() / count as f32;
    let mean_y = points.iter().map(|&(_, y)| y).sum::<f32>() / count as f32;
    let (mut numerator, mut denominator) = (0.0f32, 0.0f32);
    for &(x, y) in points {
        let dx = x - mean_x;
        numerator += dx * (y - mean_y);
        denominator += dx * dx;
    }
    let slope = if denominator > 0.0 {
        numerator / denominator
    } else {
        0.0
    };
    let residuals: Vec<f32> = points
        .iter()
        .map(|&(x, y)| y - (mean_y + slope * (x - mean_x)))
        .collect();
    population_std(&residuals)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A perfectly linear cents glide whose frames are *unevenly spaced* in time. Fitting
    /// the trend against the compacted frame index would leave ~16.7 cents of residual;
    /// fitting it against the real times leaves none.
    #[test]
    fn jitter_detrends_against_frame_time_not_the_compacted_index() {
        let times_ms = [0.0f64, 5.0, 10.0, 50.0, 55.0, 60.0];
        let cents = [0.0f32, 10.0, 20.0, 100.0, 110.0, 120.0];
        let pitches: Vec<(f64, f32)> = times_ms
            .iter()
            .zip(cents)
            .map(|(&ms, cents)| (ms / 1_000.0, 440.0 * 2.0_f32.powf(cents / 1_200.0)))
            .collect();
        let jitter = jitter_cents(&pitches);
        assert!(jitter < 1e-2, "jitter = {jitter} cents");
    }
}
