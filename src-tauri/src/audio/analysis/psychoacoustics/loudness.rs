//! Moore–Glasberg stationary loudness (M27), on the ERB-rate (Cam) axis.
//!
//! The signal chain is the stationary spectral model: transform each STFT bin's
//! level to the cochlea (outer + middle-ear transfer), spread it into an excitation
//! pattern with the level-dependent roex auditory filters, compress that into
//! specific loudness `N'(z)`, and integrate over the ERB axis to the total
//! loudness `N` (sones) and loudness level `LN` (phons).
//!
//! The constants and table values follow the published Moore–Glasberg / ISO 532-2
//! formulation as implemented by the
//! [Phonometry](https://github.com/jmrplens/phonometry) reference (see
//! [`tables`]). They are a **published approximation, not a conformance claim**: a
//! full ISO 532-2 conformance procedure is not implemented or tested here.
//!
//! The input is a mono, diotic signal, so both ears receive the same excitation.
//! The reported `N` includes the binaural sum and the model's binaural inhibition,
//! and [`FrameLoudness::specific`] is scaled the same way, so integrating it over
//! the ERB axis reproduces `N` exactly.

use std::sync::LazyLock;

use super::scales::{cam_to_hz, erb_hz};
use tables::{
    interp, T1_FREE, T1_FREQ, T1_MIDDLE, T2_10LGG, T2_FREQ, T2_LE_THR, T3_10LGG, T3_ALPHA,
    T4_10LGG, T4_A,
};

mod tables;
#[cfg(test)]
mod tests;

/// Specific-loudness calibration constant `C` (sone/Cam) of the model's
/// compressive transform.
const C_SONE: f64 = 0.0617;
/// Level dependence `D` of the lower roex skirt.
const ROEX_D: f64 = 0.35;
/// Upper-side components further than this many `g` units are dropped.
const ROEX_G_MAX: f64 = 4.0;
/// The model's ERB-number grid: 1.8 Cam to 38.9 Cam in 0.1 Cam steps.
const I_MIN: f64 = 1.8;
const I_MAX: f64 = 38.9;
const I_STEP: f64 = 0.1;
/// Above this filter centre frequency the high-frequency parameters apply.
const HF_MIN_FC_HZ: f64 = 500.0;
const ALPHA_HF: f64 = 0.2;
const A_HF: f64 = 4.13;
const E_THRQ_HF: f64 = 2.065;
/// Excitation ratio above which the high-level form of `N'` applies.
const E_HIGH_LEVEL: f64 = 1e10;
/// Binaural inhibition exponent `theta`.
const INH_THETA: f64 = 1.5978;
/// The audible component band retained by the model (Hz).
const AUDIBLE_LO_HZ: f64 = 20.0;
const AUDIBLE_HI_HZ: f64 = 20_000.0;
/// Components more than this far below the spectral peak are treated as inaudible.
const COMPONENT_FLOOR_DB: f32 = 100.0;

/// The model's fixed sample points: ERB-rate (Cam), filter centre frequency (Hz),
/// and filter bandwidth (Hz).
struct Grid {
    cam: Vec<f64>,
    hz: Vec<f64>,
    erb: Vec<f64>,
}

/// The ERB grid the excitation pattern is sampled on (built once).
fn grid() -> &'static Grid {
    static GRID: LazyLock<Grid> = LazyLock::new(|| {
        let count = ((I_MAX - I_MIN) / I_STEP).round() as usize + 1;
        let cam: Vec<f64> = (0..count)
            .map(|step| I_MIN + I_STEP * step as f64)
            .collect();
        let hz: Vec<f64> = cam
            .iter()
            .map(|&position| f64::from(cam_to_hz(position as f32)))
            .collect();
        let erb: Vec<f64> = hz
            .iter()
            .map(|&frequency| f64::from(erb_hz(frequency as f32)))
            .collect();
        Grid { cam, hz, erb }
    });
    &GRID
}

/// The loudness of one STFT frame.
pub struct FrameLoudness {
    /// Specific loudness `N'(z)` on the model's 0.1-Cam grid, both ears, sone/Cam.
    pub specific: Vec<f32>,
    /// Total loudness `N`, in sones.
    pub sone: f32,
    /// Loudness level `LN`, in phons.
    pub phon: f32,
}

/// Loudness level `LN` (phons) from loudness `N` (sones).
///
/// The conventional sone/phon relation: `40 N^0.35` below 1 sone, and
/// `40 + 10 log2 N` at and above it, so 1 sone is 40 phon.
pub fn sone_to_phon(sone: f32) -> f32 {
    if !sone.is_finite() || sone <= 0.0 {
        return 0.0;
    }
    if sone < 1.0 {
        40.0 * sone.powf(0.35)
    } else {
        40.0 + 10.0 * sone.log2()
    }
}

/// Run the stationary model for one frame.
///
/// `freqs` are the STFT bin centre frequencies in Hz and `levels` their calibrated
/// band levels in dB SPL (index-aligned). Bins outside the audible range, more than
/// [`COMPONENT_FLOOR_DB`] below the spectral peak, or non-finite are ignored.
pub fn analyze_frame(freqs: &[f32], levels: &[f32]) -> FrameLoudness {
    let grid = grid();
    let peak = freqs
        .iter()
        .zip(levels)
        .filter_map(|(&frequency, &level)| {
            (frequency.is_finite()
                && (AUDIBLE_LO_HZ..=AUDIBLE_HI_HZ).contains(&f64::from(frequency))
                && level.is_finite())
            .then_some(level)
        })
        .fold(f32::NEG_INFINITY, f32::max);
    if !peak.is_finite() {
        return silent(grid);
    }

    // (frequency Hz, power re E0) per audible component, sorted by frequency.
    let mut components: Vec<(f64, f64)> = freqs
        .iter()
        .zip(levels)
        .filter_map(|(&frequency, &level)| {
            let hertz = f64::from(frequency);
            if !hertz.is_finite()
                || !(AUDIBLE_LO_HZ..=AUDIBLE_HI_HZ).contains(&hertz)
                || !level.is_finite()
                || level <= peak - COMPONENT_FLOOR_DB
            {
                return None;
            }
            let cochlea = f64::from(level)
                + interp(hertz, &T1_FREQ, &T1_FREE)
                + interp(hertz, &T1_FREQ, &T1_MIDDLE);
            Some((hertz, 10f64.powf(cochlea / 10.0)))
        })
        .filter(|(_, power)| power.is_finite() && *power > 0.0)
        .collect();
    if components.is_empty() {
        return silent(grid);
    }
    components.sort_by(|a, b| a.0.total_cmp(&b.0));

    let source = source_levels(&components);
    let excitation = excitation(&components, &source, grid);
    let per_ear = per_ear_specific(&excitation, grid);
    let gain = binaural_gain();
    let specific: Vec<f32> = per_ear.iter().map(|&value| (value * gain) as f32).collect();
    let sone = (per_ear.iter().sum::<f64>() * gain * I_STEP) as f32;
    FrameLoudness {
        specific,
        sone: if sone.is_finite() { sone.max(0.0) } else { 0.0 },
        phon: sone_to_phon(sone),
    }
}

/// Mean specific loudness over the ERB-rate span `[z_lo, z_hi]` (Cam).
///
/// The pattern is linear between the model's 0.1-Cam samples; the integral is
/// divided by the **full** span, so summing `band_mean * span` over a partition of
/// the axis reproduces the total loudness. Bands outside the modelled range are 0.
pub fn band_mean(pattern: &[f32], z_lo: f32, z_hi: f32) -> f32 {
    let (lo, hi) = (f64::from(z_lo.min(z_hi)), f64::from(z_lo.max(z_hi)));
    let width = hi - lo;
    if !width.is_finite() || width <= 0.0 {
        return 0.0;
    }
    let grid = grid();
    let (Some(&first), Some(&last)) = (grid.cam.first(), grid.cam.last()) else {
        return 0.0;
    };
    let (lo, hi) = (lo.max(first), hi.min(last));
    if hi <= lo {
        return 0.0;
    }
    let value = |index: usize| f64::from(pattern.get(index).copied().unwrap_or(0.0));
    let mut area = 0.0;
    for (index, pair) in grid.cam.windows(2).enumerate() {
        let (z0, z1) = (pair[0], pair[1]);
        let overlap = (z1.min(hi) - z0.max(lo)).max(0.0);
        if overlap <= 0.0 || z1 <= z0 {
            continue;
        }
        // The pattern is linear on the cell, so scaling the trapezoid is exact.
        let cell = 0.5 * (value(index) + value(index + 1)) * (z1 - z0);
        area += cell * (overlap / (z1 - z0));
    }
    (area / width) as f32
}

/// An all-gap (silent) frame.
fn silent(grid: &Grid) -> FrameLoudness {
    FrameLoudness {
        specific: vec![0.0; grid.cam.len()],
        sone: 0.0,
        phon: 0.0,
    }
}

/// The excitation band level `X_j` (dB re E0) each component drives (Formula 5's
/// level dependence): the power inside one ERB around that component.
fn source_levels(components: &[(f64, f64)]) -> Vec<f64> {
    let mut cumulative = Vec::with_capacity(components.len() + 1);
    cumulative.push(0.0);
    for &(_, power) in components {
        cumulative.push(cumulative.last().copied().unwrap_or(0.0) + power);
    }
    components
        .iter()
        .map(|&(frequency, _)| {
            let half = 0.5 * f64::from(erb_hz(frequency as f32));
            let low = components.partition_point(|&(other, _)| other < frequency - half);
            let high = components.partition_point(|&(other, _)| other <= frequency + half);
            let band = (cumulative[high] - cumulative[low]).max(1e-300);
            10.0 * band.log10()
        })
        .collect()
}

/// Excitation ratio `E/E0` at every filter of `grid` (Formulae 2–5).
fn excitation(components: &[(f64, f64)], source: &[f64], grid: &Grid) -> Vec<f64> {
    let reference = 4.0 * 1000.0 / f64::from(erb_hz(1000.0));
    grid.hz
        .iter()
        .zip(&grid.erb)
        .map(|(&center, &erb)| {
            let steep = 4.0 * center / erb;
            let mut excitation = 0.0;
            for (index, &(frequency, power)) in components.iter().enumerate() {
                let g = (frequency - center).abs() / center;
                let weight = if frequency > center {
                    // Integration ranges of Formula (4): drop upper-side g > 4.
                    if g > ROEX_G_MAX {
                        0.0
                    } else {
                        let pg = steep * g;
                        (1.0 + pg) * (-pg).exp()
                    }
                } else {
                    let lower = steep - ROEX_D * (steep / reference) * (source[index] - 51.0);
                    let pg = lower.clamp(0.1, 1e4) * g;
                    (1.0 + pg) * (-pg).exp()
                };
                excitation += power * weight;
            }
            excitation
        })
        .collect()
}

/// Per-ear specific loudness `N'(z)` (sone/Cam) from the excitation pattern.
fn per_ear_specific(excitation: &[f64], grid: &Grid) -> Vec<f64> {
    excitation
        .iter()
        .zip(&grid.hz)
        .map(|(&e, &center)| {
            if e <= 0.0 {
                return 0.0;
            }
            let (alpha, a, g, threshold) = if center >= HF_MIN_FC_HZ {
                (ALPHA_HF, A_HF, 1.0, E_THRQ_HF)
            } else {
                let level = interp(center, &T2_FREQ, &T2_LE_THR);
                let gain_db = interp(center, &T2_FREQ, &T2_10LGG);
                (
                    interp(gain_db, &T3_10LGG, &T3_ALPHA),
                    interp(gain_db, &T4_10LGG, &T4_A),
                    10f64.powf(gain_db / 10.0),
                    10f64.powf(level / 10.0),
                )
            };
            let core = (g * e + a).powf(alpha) - a.powf(alpha);
            let mut value = C_SONE * core;
            if e < threshold {
                value = C_SONE * (2.0 * e / (e + threshold)).powf(1.5) * core;
            }
            if e > E_HIGH_LEVEL {
                value = C_SONE * (e / 1.0707).powf(0.2);
            }
            if value.is_finite() {
                value.max(0.0)
            } else {
                0.0
            }
        })
        .collect()
}

/// Both-ear gain for a diotic signal: two ears divided by the binaural-inhibition
/// factor of Formulae 10–13 at a unit contralateral/ipsilateral ratio, which makes
/// the reported specific loudness integrate to the reported total loudness.
fn binaural_gain() -> f64 {
    let inhibition = 2.0 / (1.0 + (1.0 / 1.0f64.cosh()).powf(INH_THETA));
    2.0 / inhibition
}
