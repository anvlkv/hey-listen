//! The STFT magnitude tools: the averaged spectrum and the spectrogram heatmap.

use super::super::support::{db_or_floor, effective_hop, effective_params, stft_magnitudes};
use super::super::{
    AnalysisError, SharedParams, SpectrogramResult, SpectrumResult, DB_FLOOR, MAX_SPEC_BINS,
    MAX_SPEC_FRAMES,
};

/// Averaged magnitude spectrum (Welch-style): the mean magnitude per bin.
pub fn spectrum(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<SpectrumResult, AnalysisError> {
    let params = effective_params(params, sample_rate);
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (mags, frames) = stft_magnitudes(mono, sample_rate, fft, hop, &params)?;
    let bins = fft / 2 + 1;
    let (min_hz, max_hz) = params.band(sample_rate);

    let mut freqs = Vec::new();
    let mut mag_db = Vec::new();
    let mut min_db = Vec::new();
    let mut max_db = Vec::new();
    let mut peak_hz = 0.0f32;
    let mut peak_db = DB_FLOOR;
    for k in 0..bins {
        let freq = k as f64 * f64::from(sample_rate) / fft as f64;
        if freq < min_hz || freq > max_hz {
            continue;
        }
        // Mean / min / max of the linear magnitude across the window's frames.
        let (mean, min, max) = if frames > 0 {
            let mut sum = 0.0f32;
            let mut min = f32::INFINITY;
            let mut max = f32::NEG_INFINITY;
            for frame in &mags {
                let value = frame[k];
                sum += value;
                min = min.min(value);
                max = max.max(value);
            }
            (sum / frames as f32, min, max)
        } else {
            (0.0, 0.0, 0.0)
        };
        let db = db_or_floor(20.0 * mean.max(1e-10).log10());
        if db > peak_db {
            peak_db = db;
            peak_hz = freq as f32;
        }
        freqs.push(freq as f32);
        mag_db.push(db);
        min_db.push(db_or_floor(20.0 * min.max(1e-10).log10()));
        max_db.push(db_or_floor(20.0 * max.max(1e-10).log10()));
    }

    Ok(SpectrumResult {
        sample_rate,
        fft_size: fft,
        hop_size: hop,
        frames,
        freqs,
        mag_db,
        min_db,
        max_db,
        peak_hz,
        peak_db,
    })
}

/// STFT magnitude heatmap (frame × frequency), band-limited and size-capped.
pub fn spectrogram(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
) -> Result<SpectrogramResult, AnalysisError> {
    let params = effective_params(params, sample_rate);
    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let (mags, frames) = stft_magnitudes(mono, sample_rate, fft, hop, &params)?;
    let all_bins = fft / 2 + 1;
    let (min_hz, max_hz) = params.band(sample_rate);

    // Keep the bins inside the band, then cap the count (max magnitude per group).
    let kept: Vec<usize> = (0..all_bins)
        .filter(|&k| {
            let freq = k as f64 * f64::from(sample_rate) / fft as f64;
            freq >= min_hz && freq <= max_hz
        })
        .collect();
    let bins = kept.len();
    let bin_group = if bins == 0 {
        1
    } else {
        bins.div_ceil(MAX_SPEC_BINS).max(1)
    };

    let frame_group = if frames == 0 {
        1
    } else {
        frames.div_ceil(MAX_SPEC_FRAMES).max(1)
    };

    // Bin centre frequencies for the retained (grouped) bins.
    let mut freqs = Vec::with_capacity(bins.div_ceil(bin_group));
    for group in kept.chunks(bin_group) {
        let sum: f64 = group
            .iter()
            .map(|&k| k as f64 * f64::from(sample_rate) / fft as f64)
            .sum();
        freqs.push((sum / group.len() as f64) as f32);
    }

    let out_frames = frames.div_ceil(frame_group);
    let mut mag_db = Vec::with_capacity(out_frames * freqs.len());
    let mut min_db = f32::INFINITY;
    let mut max_db = DB_FLOOR;
    for frame_group_start in (0..frames).step_by(frame_group) {
        let frame_end = (frame_group_start + frame_group).min(frames);
        for group in kept.chunks(bin_group) {
            let mut value = DB_FLOOR;
            for frame in &mags[frame_group_start..frame_end] {
                for &k in group {
                    let db = db_or_floor(20.0 * frame[k].max(1e-10).log10());
                    if db > value {
                        value = db;
                    }
                }
            }
            if value < min_db {
                min_db = value;
            }
            if value > max_db {
                max_db = value;
            }
            mag_db.push(value);
        }
    }

    if !min_db.is_finite() {
        min_db = DB_FLOOR;
    }

    Ok(SpectrogramResult {
        sample_rate,
        fft_size: fft,
        hop_size: hop,
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        duration: if sample_rate > 0 {
            mono.len() as f64 / f64::from(sample_rate)
        } else {
            0.0
        },
        frames: out_frames,
        bins: freqs.len(),
        freqs,
        mag_db,
        min_db,
        max_db,
    })
}
