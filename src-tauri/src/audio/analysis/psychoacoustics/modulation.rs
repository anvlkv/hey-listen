//! The shared band-envelope → modulation-filter pipeline behind `roughness` and
//! `fluctuationStrength` (M29).
//!
//! Both tools ask the same question — *how fast and how deeply does the energy in each
//! critical band fluctuate?* — and differ only in the modulation-rate weighting they
//! apply: roughness is centred near **70 Hz**, fluctuation strength near **4 Hz**. Per
//! band:
//!
//! 1. A second-order band-pass over the Bark-band edges of the shared frequency range
//!    turns the signal into a critical-band waveform.
//! 2. Rectifying and smoothing it (two one-pole low-passes at [`ENVELOPE_LP_HZ`],
//!    decimated to about [`ENVELOPE_RATE_HZ`]) yields the band envelope `e_b(t)`.
//! 3. Two cascaded band-passes at the tool's target rate isolate that rate's
//!    modulation. The filtered envelope's amplitude over the band's mean envelope is
//!    the band's fractional modulation depth `m_b`. A filter is used rather than a
//!    windowed DFT bin so the estimate settles in a few periods at *either* rate
//!    instead of needing a window tuned to the rate (a 4 Hz bin needs seconds, a 70 Hz
//!    bin milliseconds).
//! 4. Bands combine as a mean over the frame weighted by each band's energy, by the
//!    perceived-frequency taper `g(z)` (1 up to 15 Bark, falling to 0.5 at 23.5 Bark)
//!    and — with the coherence rule each tool picks — by how strongly adjacent bands
//!    modulate together.
//!
//! Reference conditions: a 1 kHz tone at 60 dB SPL, 100 %-amplitude-modulated at
//! 70 Hz, reads about 1 asper; the same tone at 4 Hz reads about 1 vacil. Each tool
//! file carries its calibration constant. A steady carrier reads about 0 for both.
//!
//! **This is a model approximation, not a conformance implementation.** It follows the
//! shape of the published Daniel–Weber roughness and Osses–García–Kohlrausch
//! fluctuation-strength models (Bark-band envelopes, a modulation filter per rate, a
//! frequency taper, an inter-band coherence term) using its own filterbank and
//! constants, so it reproduces the reference conditions and the rough-vs-pulsing
//! trend — not any standard's numeric limits.

mod filters;

use super::super::support::{effective_hop, frame_times};
use super::super::{CalibratedSeriesResult, SharedParams};
use super::bands::critical_band_edges;
use super::scales::{bark, Scale};
use filters::{Biquad, OnePole};

/// Target envelope sample rate (Hz): ~14 samples per cycle of a 70 Hz modulation.
const ENVELOPE_RATE_HZ: f64 = 1_000.0;
/// Envelope smoothing cutoff (Hz), applied as two cascaded one-pole low-passes. Below
/// the envelope rate's Nyquist and far below the carriers it must not track.
const ENVELOPE_LP_HZ: f64 = 200.0;
/// The Bark-band filterbank's quality factors: a band never gets narrower than its
/// own Bark width (Q = f₀ / bandwidth) nor sharper than this, so the AM sidebands of
/// a carrier near the band centre stay inside the band.
const BAND_Q_MIN: f64 = 1.0;
const BAND_Q_MAX: f64 = 4.0;
/// The calibration from the raw weighted depth to 1 asper, measured on the reference
/// condition through this pipeline (it absorbs the coherence discount and the band
/// weighting, not a standard constant).
const ROUGHNESS_SCALE: f64 = 2.672;
/// The same, to 1 vacil.
const FLUCTUATION_SCALE: f64 = 1.172;
/// The level at which the model's level weighting reaches full scale: the loudest
/// band envelope of a 60 dB SPL (peak) reference tone is about 3 dB below its peak
/// level, i.e. ≈ 57 dB SPL. Quieter sound is weighted down (6 dB per halving), louder
/// is not weighted up.
const REFERENCE_LEVEL_DB: f64 = 57.0;

/// How a frame's per-band contributions combine.
#[derive(Clone, Copy)]
pub(crate) enum Coherence {
    /// Roughness: adjacent bands that modulate in step are one rough sound rather
    /// than two, so a contribution is divided by `1 + max(ρ, 0)`.
    Suppress,
    /// Fluctuation strength: the contribution scales with `0.5 + 0.5 |ρ|`, bounded
    /// so a band with no measurable neighbour still counts.
    Weight,
}

/// One tool's modulation-rate weighting.
pub(crate) struct Weighting {
    /// The modulation rate the tool measures, in Hz.
    pub target_hz: f64,
    /// The band-pass quality factor of the modulation filter (bandwidth =
    /// `target_hz / q`).
    pub q: f64,
    /// The window the per-frame depth is integrated over, in seconds.
    pub window_secs: f64,
    /// Exponent on the depth, the frequency weight and the coherence factor.
    pub exponent: f64,
    /// How adjacent-band coherence enters the sum.
    pub coherence: Coherence,
    /// The calibration from the raw weighted depth to 1 asper / 1 vacil.
    pub scale: f64,
}

/// The roughness weighting: a 70 Hz modulation filter, a 100 ms integration window,
/// a contribution linear in the modulation depth, and a coherence suppression.
/// [`ROUGHNESS_SCALE`] puts the 1 kHz / 60 dB SPL / 100 % AM / 70 Hz reference at
/// about 1 asper.
pub(crate) fn roughness_weighting() -> Weighting {
    Weighting {
        target_hz: 70.0,
        q: 2.0,
        window_secs: 0.1,
        exponent: 1.0,
        coherence: Coherence::Suppress,
        scale: ROUGHNESS_SCALE,
    }
}

/// The fluctuation-strength weighting: a 4 Hz modulation filter, a 0.5 s integration
/// window (two periods of the slowest rate the model targets), the 1.7 depth / weight
/// / coherence exponent of the published model, and a coherence weight.
/// [`FLUCTUATION_SCALE`] puts the 1 kHz / 60 dB SPL / 100 % AM / 4 Hz reference at
/// about 1 vacil.
pub(crate) fn fluctuation_weighting() -> Weighting {
    Weighting {
        target_hz: 4.0,
        q: 1.0,
        window_secs: 0.5,
        exponent: 1.7,
        coherence: Coherence::Weight,
        scale: FLUCTUATION_SCALE,
    }
}

/// One critical band: its Bark position and its envelope at the envelope rate.
struct Band {
    z: f64,
    envelope: Vec<f32>,
}

/// The Bark-band envelope of `mono`, plus the envelope sample rate it runs at.
fn envelopes(mono: &[f32], sample_rate: u32, min_hz: f32, max_hz: f32) -> (Vec<Band>, f64) {
    let rate = f64::from(sample_rate.max(1));
    // A very long window widens the decimation so the envelope stays bounded; the
    // effective rate is returned so the frame mapping follows it.
    let decim = ((rate / ENVELOPE_RATE_HZ).round() as usize)
        .max(1)
        .max(mono.len().div_ceil(super::super::MAX_MODULATION_ENVELOPE));
    let envelope_rate = rate / decim as f64;

    let edges = critical_band_edges(Scale::Bark, min_hz, max_hz);
    let bands = edges
        .windows(2)
        .map(|pair| {
            let centre = (f64::from(pair[0]) * f64::from(pair[1])).sqrt().max(20.0);
            let width = (f64::from(pair[1]) - f64::from(pair[0])).max(20.0);
            let q = (centre / width).clamp(BAND_Q_MIN, BAND_Q_MAX);
            let mut pass = Biquad::band_pass(centre, q, rate);
            let mut smooth_a = OnePole::low_pass(ENVELOPE_LP_HZ, rate);
            let mut smooth_b = OnePole::low_pass(ENVELOPE_LP_HZ, rate);
            let mut envelope = Vec::with_capacity(mono.len() / decim + 1);
            for (index, &sample) in mono.iter().enumerate() {
                let band = pass.process(f64::from(sample)).abs();
                let smoothed = smooth_b.process(smooth_a.process(band));
                if index % decim == 0 {
                    envelope.push(smoothed as f32);
                }
            }
            Band {
                z: f64::from(bark(centre as f32)),
                envelope,
            }
        })
        .collect();
    (bands, envelope_rate)
}

/// The `g(z)` frequency taper: 1 up to 15 Bark, then a linear fall to 0.5 at 23.5.
fn frequency_weight(z: f64) -> f64 {
    if z <= 15.0 {
        1.0
    } else {
        (1.0 - 0.5 * (z - 15.0) / (23.5 - 15.0)).clamp(0.5, 1.0)
    }
}

/// The level weighting: full scale at [`REFERENCE_LEVEL_DB`] and above, halving every
/// 6 dB below it. Uncalibrated runs (`calibration_db_spl == 0`) are relative, so the
/// factor is left at 1 rather than inventing an absolute level.
fn level_weight(level_db: f64, calibration_db_spl: f32) -> f64 {
    if calibration_db_spl <= 0.0 {
        1.0
    } else {
        10f64
            .powf((level_db + f64::from(calibration_db_spl) - REFERENCE_LEVEL_DB) / 20.0)
            .clamp(0.0, 1.0)
    }
}

/// The normalized cross-covariance `ρ` of two equal-length windows, in `[-1, 1]`.
fn correlation(a: &[f32], b: &[f32]) -> f64 {
    let n = a.len() as f64;
    if n < 2.0 {
        return 0.0;
    }
    let (mut sa, mut sb, mut sab, mut saa, mut sbb) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for (&x, &y) in a.iter().zip(b) {
        let (x, y) = (f64::from(x), f64::from(y));
        sa += x;
        sb += y;
        sab += x * y;
        saa += x * x;
        sbb += y * y;
    }
    let numerator = sab - sa * sb / n;
    let variance = (saa - sa * sa / n) * (sbb - sb * sb / n);
    if variance <= 0.0 {
        0.0
    } else {
        (numerator / variance.sqrt()).clamp(-1.0, 1.0)
    }
}

/// The weighted modulation of `mono` per analysis frame, in the tool's unit before
/// the calibration constant — `None` for a frame with nothing to measure.
///
/// Also returns the effective hop (samples) the frames sit on.
pub(crate) fn modulate(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    weighting: &Weighting,
    calibration_db_spl: f32,
) -> (usize, Vec<Option<f32>>) {
    let (min_hz, max_hz) = params.band(sample_rate);
    let (bands, envelope_rate) = envelopes(mono, sample_rate, min_hz as f32, max_hz as f32);

    // Filter each band envelope at the target rate, warming the filter on the
    // envelope's own start rounded to whole modulation periods so the record does not
    // begin with a step the filter would ring on.
    let settle = {
        let period = (envelope_rate / weighting.target_hz).max(1.0);
        (5.0 * weighting.q / std::f64::consts::PI).ceil() * period
    };
    let settle = settle.round() as usize;
    let modulation: Vec<Vec<f32>> = bands
        .iter()
        .map(|band| {
            let mut first = Biquad::band_pass(weighting.target_hz, weighting.q, envelope_rate);
            let mut second = Biquad::band_pass(weighting.target_hz, weighting.q, envelope_rate);
            if !band.envelope.is_empty() {
                for index in 0..settle {
                    let sample = f64::from(band.envelope[index % band.envelope.len()]);
                    second.process(first.process(sample));
                }
            }
            band.envelope
                .iter()
                .map(|&sample| second.process(first.process(f64::from(sample))) as f32)
                .collect()
        })
        .collect();

    let fft = params.fft_size();
    let hop = effective_hop(fft, mono.len(), params.hop_size(fft));
    let frames = mono.len().div_ceil(hop);
    let samples = bands.first().map_or(0, |band| band.envelope.len());
    let window = (weighting.window_secs * envelope_rate).round().max(2.0) as usize;

    let values = (0..frames)
        .map(|frame| {
            // A centred window of `window` envelope samples around the frame time.
            let centre = (frame * hop) as f64 / f64::from(sample_rate.max(1)) * envelope_rate;
            let centre = centre.round() as isize;
            let low = (centre - window as isize / 2).max(0) as usize;
            let high = ((centre + window as isize / 2) as usize).min(samples);
            if high <= low + 1 {
                return None;
            }
            frame_value(
                &bands,
                &modulation,
                low,
                high,
                weighting,
                calibration_db_spl,
            )
        })
        .collect();
    (hop, values)
}

/// One frame's weighted modulation over the envelope window `[low, high)`.
fn frame_value(
    bands: &[Band],
    modulation: &[Vec<f32>],
    low: usize,
    high: usize,
    weighting: &Weighting,
    calibration_db_spl: f32,
) -> Option<f32> {
    let count = (high - low) as f64;
    let mut energies = Vec::with_capacity(bands.len());
    let mut depths = Vec::with_capacity(bands.len());
    let mut loudest = 0.0f64;
    for (index, band) in bands.iter().enumerate() {
        let window = &band.envelope[low..high];
        let mean = window.iter().map(|&v| f64::from(v)).sum::<f64>() / count;
        loudest = loudest.max(mean);
        let energy = mean * mean;
        energies.push(energy);
        let filtered = &modulation[index][low..high];
        let power = filtered.iter().map(|&v| f64::from(v).powi(2)).sum::<f64>() / count;
        depths.push(if mean > 1e-9 {
            // A sinusoid of amplitude `a` has RMS `a / √2`.
            (2.0 * power).sqrt() / mean
        } else {
            0.0
        });
    }
    let total_energy: f64 = energies.iter().sum();
    if total_energy <= 1e-20 {
        return None;
    }
    let gain = level_weight(20.0 * loudest.max(1e-12).log10(), calibration_db_spl);
    let exponent = weighting.exponent;
    let mut sum = 0.0f64;
    for (index, band) in bands.iter().enumerate() {
        let weight = energies[index] / total_energy;
        let coherence = if index + 1 < modulation.len() {
            correlation(
                &modulation[index][low..high],
                &modulation[index + 1][low..high],
            )
        } else {
            0.0
        };
        let coherence = match weighting.coherence {
            Coherence::Suppress => 1.0 / (1.0 + coherence.max(0.0)),
            Coherence::Weight => 0.5 + 0.5 * coherence.abs(),
        };
        sum += weight
            * depths[index].powf(exponent)
            * frequency_weight(band.z).powf(exponent)
            * coherence.powf(exponent);
    }
    let value = weighting.scale * gain * sum;
    value.is_finite().then_some(value as f32)
}

/// A `CalibratedSeriesResult` over the frames of `values`, recording the calibration
/// the run was asked for.
pub(crate) fn series(
    values: Vec<Option<f32>>,
    hop: usize,
    sample_rate: u32,
    calibration_db_spl: f32,
) -> CalibratedSeriesResult {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
    }
    CalibratedSeriesResult {
        sample_rate,
        hop_size: hop,
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        times: frame_times(values.len(), hop, sample_rate),
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        calibrated: calibration_db_spl > 0.0,
        calibration_db_spl,
    }
}

#[cfg(test)]
mod tests;
