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
//! 2. Rectifying and smoothing it (two one-pole low-passes, decimated to about
//!    [`ENVELOPE_RATE_HZ`]) yields the band envelope `e_b(t)`. The smoother's cutoff is
//!    never above [`RIPPLE_GUARD`] × the band's own centre, so the **doubled carrier**
//!    a full-wave rectifier produces (a 35 Hz carrier rectifies to 70 Hz — exactly the
//!    roughness rate) stays two octaves above it: a steady carrier yields a flat
//!    envelope instead of spurious roughness. The cutoff is also kept below the
//!    decimation's anti-alias corner, and a biquad low-pass precedes the decimation, so
//!    the envelope rate is not aliased.
//! 3. Two cascaded band-passes at the tool's target rate isolate that rate's
//!    modulation. The filtered envelope's amplitude over the band's mean envelope is
//!    the band's fractional modulation depth `m_b`. A filter is used rather than a
//!    windowed DFT bin so the estimate settles in a few periods at *either* rate
//!    instead of needing a window tuned to the rate (a 4 Hz bin needs seconds, a 70 Hz
//!    bin milliseconds).
//! 4. Bands combine as a mean over the frame weighted by each band's energy, by the
//!    perceived-frequency taper `g(z)` (1 up to 15 Bark, falling to 0.5 at 23.5 Bark)
//!    and — with the coherence rule each tool picks — by how strongly adjacent bands
//!    modulate together. A band whose envelope is more than 40 dB below the frame's
//!    broadband level (see [`BAND_GATE`]) is dropped, so a carrier **outside** the
//!    selected range does not reach the modulation filter through the band-pass
//!    skirts. Spectrally adjacent carriers still overlap a band by design; the gate is
//!    a level test, not a brick wall.
//!
//! The envelope rate depends on the **sample rate alone** — never on the selection's
//! duration — and the streaming pass below retains only the frame windows, so an
//! hour-long selection keeps the same modulation bandwidth as a short one instead of
//! decimating 70 Hz into a slow wobble.
//!
//! The **band × rate matrix** (M36) is measured separately from the same retained
//! envelope windows: a single-bin DFT at each rate of a bounded 1–100 Hz grid (see
//! [`rates`]) gives each band's fractional modulation depth per rate for a drill-down.
//! It describes the raw envelope and is not part of the scalar above, which still comes
//! from the modulation filter.
//!
//! The level weighting is one-sided: full scale at or above the reference level and
//! 6 dB down per halving below it, so scaling a reference-level signal *up* does not
//! raise the reported asper. It is a level gate, not a measured roughness-versus-level
//! curve.
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
mod rates;
mod series;
mod stream;

pub(crate) use series::series;

use super::super::{SharedParams, MAX_MODULATION_ENVELOPE};
use filters::Channel;
use rates::RateCells;
use stream::{Frame, Pass};

/// Target envelope sample rate (Hz): ~14 samples per cycle of a 70 Hz modulation.
const ENVELOPE_RATE_HZ: f64 = 1_000.0;
/// Envelope smoothing cutoff (Hz), applied as two cascaded one-pole low-passes.
const ENVELOPE_LP_HZ: f64 = 200.0;
/// The smoother cutoff is capped at this fraction of a band's centre, so the
/// rectifier's doubled carrier stays well above it (see `filters::envelope_cutoff`).
const RIPPLE_GUARD: f64 = 0.25;
/// The envelope's anti-alias low-pass sits at this fraction of the envelope rate:
/// below its Nyquist and far above the fastest modulation either tool measures.
const ANTI_ALIAS_FRACTION: f64 = 0.4;
/// A band more than 40 dB below the frame's broadband level contributes nothing.
const BAND_GATE: f64 = 0.01;
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
/// is not weighted up — see [`level_weight`].
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
    /// Whether to collect the per-frame band × modulation-rate matrix (M36). Both
    /// tools want it; the flag keeps the per-band scalar path usable without it.
    pub collect_rates: bool,
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
        collect_rates: true,
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
        collect_rates: true,
    }
}

/// The source-to-envelope decimation: a function of the sample rate alone, so the
/// envelope rate (and with it the measurable modulation bandwidth) is identical for a
/// short and an hour-long selection.
fn decimation(rate: f64) -> usize {
    ((rate / ENVELOPE_RATE_HZ).round() as usize).max(1)
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
///
/// The clamp at 1 is deliberate and one-sided: a signal louder than the reference is
/// *not* weighted up, so an amplitude sweep cannot be read as a conventional
/// roughness-versus-level curve (which rises and then saturates or falls).
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

/// One window's modulation measurement: the effective hop, the scalar value per frame,
/// and the per-band grid the values decompose into (M36).
pub(crate) struct Modulation {
    /// The effective hop (samples) the frames sit on.
    pub hop: usize,
    /// The tool's value per frame, in its unit; `None` for a frame with nothing to
    /// measure.
    pub values: Vec<Option<f32>>,
    /// The critical bands' centre frequencies (Hz), the contribution grid's columns.
    pub bands: Vec<f32>,
    /// Frame-major `frames × bands` contributions, in the tool's unit — see [`series`].
    pub contributions: Vec<f32>,
    /// The modulation rates (Hz) of the band × rate matrix; empty when the weighting
    /// does not collect one.
    pub rates: Vec<f32>,
    /// Frame-major, then band-major, then rate `frames × bands × rates` fractional
    /// modulation depths — see [`series`]. Empty when `rates` is.
    pub rate_values: Vec<f32>,
}

/// The weighted modulation of `mono` per analysis frame, in the tool's unit, with the
/// per-band contributions that produced each value.
pub(crate) fn modulate(
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    weighting: &Weighting,
    calibration_db_spl: f32,
) -> Modulation {
    let mut pass = Pass::new(mono, sample_rate, params, weighting, calibration_db_spl);
    // Chronological blocks of at most [`MAX_MODULATION_ENVELOPE`] envelope samples keep
    // the pass bounded without widening the decimation; the filter state crosses them.
    let block = MAX_MODULATION_ENVELOPE
        .saturating_mul(pass.decimation())
        .max(1);
    for chunk in mono.chunks(block) {
        for &sample in chunk {
            pass.push(f64::from(sample));
        }
    }
    pass.finish()
}

/// The per-frame outputs [`frame_value`] fills: the per-band contribution columns and,
/// when the tool collects one, the band × rate cells.
struct FrameCells<'a> {
    contributions: &'a mut [f32],
    rates: RateCells<'a>,
}

/// One frame's weighted modulation over the copied band windows of `count` envelope
/// samples, with `level` the frame's broadband RMS amplitude.
///
/// `cells` receives each band's share of the frame's value — `scale · gain ·
/// weight · depth^e · g^e · coherence^e` — so its columns sum to the returned scalar,
/// plus the band's rate spectrum (M36). The rate half is a no-op when the tool does not
/// collect one.
fn frame_value(
    channels: &mut [Channel],
    frame: &mut Frame,
    count: usize,
    level: f64,
    weighting: &Weighting,
    calibration_db_spl: f32,
    cells: &mut FrameCells<'_>,
) -> Option<f32> {
    if count < 2 || channels.iter().any(|channel| channel.available() < count) {
        return None;
    }
    frame.fill(channels, count);
    let count_f = count as f64;
    let gate = level * BAND_GATE;
    let mut energies = Vec::with_capacity(channels.len());
    let mut depths = Vec::with_capacity(channels.len());
    let mut loudest = 0.0f64;
    for index in 0..channels.len() {
        let envelope = frame.envelope(index);
        let mean = envelope.iter().map(|&v| f64::from(v)).sum::<f64>() / count_f;
        loudest = loudest.max(mean);
        if mean < gate {
            // Band-pass leakage, not a component the range selection measures.
            energies.push(0.0);
            depths.push(0.0);
            continue;
        }
        energies.push(mean * mean);
        cells.rates.collect(index, envelope, mean);
        let filtered = frame.modulated(index);
        let power = filtered.iter().map(|&v| f64::from(v).powi(2)).sum::<f64>() / count_f;
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
    let scale = weighting.scale * gain;
    let mut sum = 0.0f64;
    for (index, channel) in channels.iter().enumerate() {
        let weight = energies[index] / total_energy;
        let coherence = if index + 1 < channels.len() {
            correlation(frame.modulated(index), frame.modulated(index + 1))
        } else {
            0.0
        };
        let coherence = match weighting.coherence {
            Coherence::Suppress => 1.0 / (1.0 + coherence.max(0.0)),
            Coherence::Weight => 0.5 + 0.5 * coherence.abs(),
        };
        let term = weight
            * depths[index].powf(exponent)
            * frequency_weight(channel.z).powf(exponent)
            * coherence.powf(exponent);
        sum += term;
        if let Some(cell) = cells.contributions.get_mut(index) {
            *cell = (scale * term) as f32;
        }
    }
    let value = weighting.scale * gain * sum;
    value.is_finite().then_some(value as f32)
}

#[cfg(test)]
mod tests;
