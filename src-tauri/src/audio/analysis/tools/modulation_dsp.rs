//! Shared DSP for the AM/FM modulation tool (M20): envelope conversion, detrending,
//! a bounded radix-2 FFT, the shared rate grid, ranked peak picking, and the voiced
//! run the FM half analyses.
//!
//! The spectra are reported **relative** to their strongest bin, so no window-gain
//! normalization is needed and the result is independent of the signal's level. See
//! `docs/analysis-metrics.md` → M20.

use oxiaudio::dsp::PitchFrame;

use super::super::{Detrend, DB_FLOOR, MAX_MOD_BINS, MAX_MOD_FFT};
use super::notes::median;

/// The bridge across a short unvoiced gap before the FM run is cut.
const BRIDGE_SECS: f32 = 0.05;
/// A ranked peak must stand this far above its surrounding valley. Below it the
/// spectrum is effectively flat (a steady signal or pure numerical noise), and
/// reporting the argmax would invent a modulation rate that is not there.
const MIN_PEAK_PROMINENCE_DB: f32 = 3.0;

/// One continuous voiced stretch of a pitch track.
#[derive(Debug, Clone, Copy)]
pub(super) struct VoicedRun {
    /// The run's first and last frame indices (both voiced).
    pub first: usize,
    pub last: usize,
}

/// Frame-RMS levels in dBFS as a linear amplitude envelope (RMS ∝ 10^(dB/20)).
pub(super) fn linear_envelope(levels_db: &[f32]) -> Vec<f32> {
    levels_db
        .iter()
        .map(|&db| 10f32.powf(db.max(DB_FLOOR) / 20.0))
        .collect()
}

/// Remove the mean — and, for [`Detrend::Linear`], a least-squares line — from `values`.
pub(super) fn detrended(values: &[f32], mode: Detrend) -> Vec<f32> {
    let count = values.len();
    if count == 0 {
        return Vec::new();
    }
    let mean = values.iter().sum::<f32>() / count as f32;
    if mode == Detrend::Mean || count < 2 {
        return values.iter().map(|value| value - mean).collect();
    }
    let mean_x = (count - 1) as f32 / 2.0;
    let (mut numerator, mut denominator) = (0.0f32, 0.0f32);
    for (index, &value) in values.iter().enumerate() {
        let dx = index as f32 - mean_x;
        numerator += dx * (value - mean);
        denominator += dx * dx;
    }
    let slope = if denominator > 0.0 {
        numerator / denominator
    } else {
        0.0
    };
    values
        .iter()
        .enumerate()
        .map(|(index, &value)| value - (mean + slope * (index as f32 - mean_x)))
        .collect()
}

/// A uniform modulation-rate grid over `min_hz..=max_hz`. The spacing is about twice
/// the window's natural resolution (`0.5 / duration`), floored so a long window does
/// not produce an unbounded axis, and the whole grid is capped at [`MAX_MOD_BINS`].
pub(super) fn rate_grid(min_hz: f32, max_hz: f32, duration_secs: f32) -> Vec<f32> {
    let span = (max_hz - min_hz).max(1e-3);
    let spacing = (0.5 / duration_secs.max(1e-3)).max(0.05);
    let count = ((span / spacing).ceil() as usize + 1).clamp(16, MAX_MOD_BINS);
    (0..count)
        .map(|index| min_hz + span * index as f32 / (count - 1) as f32)
        .collect()
}

/// A Hann-windowed magnitude spectrum of `values` sampled at `sample_rate`, evaluated
/// at `freqs` and expressed in dB relative to its strongest point.
pub(super) fn spectrum(values: &[f32], sample_rate: f32, mode: Detrend, freqs: &[f32]) -> Vec<f32> {
    if values.len() < 2 || freqs.is_empty() || sample_rate <= 0.0 {
        return vec![DB_FLOOR; freqs.len()];
    }
    let centred = detrended(values, mode);
    let last = (centred.len() - 1).max(1) as f32;
    let windowed: Vec<f32> = centred
        .iter()
        .enumerate()
        .map(|(index, &value)| {
            value * (0.5 - 0.5 * (std::f32::consts::TAU * index as f32 / last).cos())
        })
        .collect();
    let (magnitudes, n_fft) = fft_magnitudes(&windowed);
    let bin_hz = sample_rate / n_fft as f32;
    let mut out: Vec<f32> = freqs
        .iter()
        .map(|&hz| interpolate(&magnitudes, bin_hz, hz))
        .collect();
    let max = out.iter().copied().fold(0.0f32, f32::max);
    for value in &mut out {
        *value = if max > 0.0 {
            (20.0 * (*value / max).max(1e-6).log10()).max(DB_FLOOR)
        } else {
            DB_FLOOR
        };
    }
    out
}

/// The magnitudes of `samples` zero-padded to the next power of two, plus that length.
/// Only the non-negative half is returned (`n / 2 + 1` entries).
fn fft_magnitudes(samples: &[f32]) -> (Vec<f32>, usize) {
    let n = samples.len().clamp(2, MAX_MOD_FFT).next_power_of_two();
    let mut re = vec![0.0f64; n];
    let mut im = vec![0.0f64; n];
    for (slot, &value) in re.iter_mut().zip(samples.iter().take(n)) {
        *slot = f64::from(value);
    }

    // Bit-reversal permutation.
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    // Iterative Cooley–Tukey butterflies.
    let mut len = 2;
    while len <= n {
        let angle = -std::f64::consts::TAU / len as f64;
        let (step_re, step_im) = (angle.cos(), angle.sin());
        let mut start = 0;
        while start < n {
            let (mut tw_re, mut tw_im) = (1.0f64, 0.0f64);
            for k in 0..len / 2 {
                let (ur, ui) = (re[start + k], im[start + k]);
                let (vr0, vi0) = (re[start + k + len / 2], im[start + k + len / 2]);
                let vr = vr0 * tw_re - vi0 * tw_im;
                let vi = vr0 * tw_im + vi0 * tw_re;
                re[start + k] = ur + vr;
                im[start + k] = ui + vi;
                re[start + k + len / 2] = ur - vr;
                im[start + k + len / 2] = ui - vi;
                let next_re = tw_re * step_re - tw_im * step_im;
                tw_im = tw_re * step_im + tw_im * step_re;
                tw_re = next_re;
            }
            start += len;
        }
        len <<= 1;
    }

    let half = n / 2;
    let magnitudes = (0..=half)
        .map(|k| ((re[k] * re[k] + im[k] * im[k]).sqrt()) as f32)
        .collect();
    (magnitudes, n)
}

/// Linear interpolation of a magnitude axis sampled every `bin_hz`.
fn interpolate(magnitudes: &[f32], bin_hz: f32, hz: f32) -> f32 {
    if magnitudes.is_empty() || bin_hz <= 0.0 {
        return 0.0;
    }
    let position = (hz / bin_hz).max(0.0);
    let low = position.floor() as usize;
    if low >= magnitudes.len() - 1 {
        return *magnitudes.last().unwrap_or(&0.0);
    }
    let fraction = position - low as f32;
    magnitudes[low] * (1.0 - fraction) + magnitudes[low + 1] * fraction
}

/// The `top` strongest local maxima that stand above their valley, strongest first.
pub(super) fn peaks(freqs: &[f32], db: &[f32], top: usize) -> Vec<super::super::ModulationPeak> {
    if freqs.len() != db.len() || db.is_empty() {
        return Vec::new();
    }
    let mut candidates: Vec<(usize, f32)> = (0..db.len())
        .filter(|&index| local_max(db, index))
        .map(|index| (index, prominence(db, index)))
        .filter(|(_, prominence)| *prominence >= MIN_PEAK_PROMINENCE_DB)
        .collect();
    candidates.sort_by(|(a, _), (b, _)| db[*b].total_cmp(&db[*a]));
    candidates.truncate(top.max(1));
    candidates
        .into_iter()
        .map(|(index, prominence_db)| super::super::ModulationPeak {
            rate_hz: freqs[index],
            relative_db: db[index],
            prominence_db,
        })
        .collect()
}

fn local_max(db: &[f32], index: usize) -> bool {
    let left = index == 0 || db[index] >= db[index - 1];
    let right = index + 1 == db.len() || db[index] > db[index + 1];
    left && right
}

/// Peak minus the higher of its two flanking valley floors.
fn prominence(db: &[f32], index: usize) -> f32 {
    let mut left = db[index];
    for value in db[..index].iter().rev() {
        if *value > db[index] {
            break;
        }
        left = left.min(*value);
    }
    let mut right = db[index];
    for value in &db[index + 1..] {
        if *value > db[index] {
            break;
        }
        right = right.min(*value);
    }
    (db[index] - left.max(right)).max(0.0)
}

/// The longest voiced run (bridging unvoiced gaps up to [`BRIDGE_SECS`]), or `None`
/// when none lasts at least `min_voiced_secs`.
pub(super) fn longest_voiced_run(
    frames: &[PitchFrame],
    hop_secs: f32,
    min_voiced_secs: f32,
) -> Option<VoicedRun> {
    let voiced: Vec<usize> = frames
        .iter()
        .enumerate()
        .filter(|(_, frame)| {
            frame.is_voiced && frame.frequency_hz.is_finite() && frame.frequency_hz > 0.0
        })
        .map(|(index, _)| index)
        .collect();
    let first = *voiced.first()?;
    let bridge_secs = f64::from(BRIDGE_SECS + hop_secs.max(0.0));
    let hop = f64::from(hop_secs.max(0.0));
    let span = |a: usize, b: usize| frames[b].time_seconds - frames[a].time_seconds + hop;

    let mut best: Option<(usize, usize)> = None;
    let mut start = first;
    let mut last = first;
    for &index in &voiced[1..] {
        if frames[index].time_seconds - frames[last].time_seconds <= bridge_secs {
            last = index;
        } else {
            keep_if_longer(&mut best, (start, last), &span);
            start = index;
            last = index;
        }
    }
    keep_if_longer(&mut best, (start, last), &span);
    let (first, last) = best?;
    if span(first, last) < f64::from(min_voiced_secs) {
        return None;
    }
    Some(VoicedRun { first, last })
}

fn keep_if_longer<F>(best: &mut Option<(usize, usize)>, candidate: (usize, usize), span: &F)
where
    F: Fn(usize, usize) -> f64,
{
    let longer = best
        .map(|current| span(candidate.0, candidate.1) > span(current.0, current.1))
        .unwrap_or(true);
    if longer {
        *best = Some(candidate);
    }
}

/// The run's f0 track in cents around its median, with short unvoiced gaps linearly
/// interpolated so the series stays uniformly sampled.
pub(super) fn cents_track(frames: &[PitchFrame], run: VoicedRun) -> Vec<f32> {
    let slice = &frames[run.first..=run.last];
    let voiced: Vec<f32> = slice
        .iter()
        .filter(|frame| frame.is_voiced && frame.frequency_hz > 0.0)
        .map(|frame| frame.frequency_hz)
        .collect();
    if voiced.is_empty() {
        return Vec::new();
    }
    let reference = median(&voiced).max(1.0);
    let cents: Vec<Option<f32>> = slice
        .iter()
        .map(|frame| {
            (frame.is_voiced && frame.frequency_hz > 0.0)
                .then(|| 1_200.0 * (frame.frequency_hz / reference).log2())
        })
        .collect();

    let mut out: Vec<f32> = Vec::with_capacity(cents.len());
    let mut index = 0;
    while index < cents.len() {
        if let Some(value) = cents[index] {
            out.push(value);
            index += 1;
            continue;
        }
        // Interpolate a gap between the surrounding voiced values (the run starts and
        // ends voiced, so both sides exist).
        let start = index;
        while index < cents.len() && cents[index].is_none() {
            index += 1;
        }
        let left = cents[start - 1].unwrap_or(0.0);
        let right = cents.get(index).copied().flatten().unwrap_or(left);
        let steps = (index - start + 1) as f32;
        for offset in start..index {
            let t = (offset - start + 1) as f32 / steps;
            out.push(left + (right - left) * t);
        }
    }
    out
}

/// Peak-to-peak and population standard deviation of a series.
pub(super) fn depth(values: &[f32]) -> (f32, f32) {
    if values.is_empty() {
        return (0.0, 0.0);
    }
    let (mut min, mut max) = (f32::INFINITY, f32::NEG_INFINITY);
    let mut sum = 0.0f32;
    for &value in values {
        min = min.min(value);
        max = max.max(value);
        sum += value;
    }
    let mean = sum / values.len() as f32;
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f32>()
        / values.len() as f32;
    (max - min, variance.sqrt())
}
