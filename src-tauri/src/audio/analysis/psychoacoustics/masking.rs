//! Tonal / non-tonal masker detection and the MPEG-style masking threshold (M30).
//!
//! Per spectral line `i` the model builds the **global masking threshold**
//!
//! ```text
//! Tg(i) = 10 log10( 10^(Tq(i)/10) + Σ_j 10^(LT_j(i)/10) )
//! SMR(i) = L(i) − Tg(i)
//! ```
//!
//! where `Tq` is the threshold in quiet ([`super::threshold`]), `L` the line level,
//! and `LT_j(i) = X_j + av(z_j) + vf(z_i − z_j, X_j)` a masker's contribution spread
//! over the Bark distance `dz = z_i − z_j`.
//!
//! Maskers are the spectrum's **tonal** components — local maxima that stand at least
//! 7 dB above the lines in their Bark neighbourhood, each carrying the power of its
//! **main lobe** — and the remaining **residual (non-tonal) energy**, grouped into
//! bands about [`NON_TONAL_BAND_BARK`] wide so broadband noise masks even when it has
//! no local peak. Tonal maskers within 0.5 Bark of a stronger one are merged. The two
//! masker types use the published MPEG-style masking-index and spreading-function
//! constants.
//!
//! This is the model a codec's psychoacoustic analysis uses, not a universal predictor
//! of human detection: the reference curves assume a quiet context, the shared window
//! and the supplied calibration. `Tq` is a dB SPL curve, so [`masking_thresholds`]
//! combines it only for a **calibrated** spectrum; an uncalibrated run sums the
//! maskers alone, keeping `Tg` in the spectrum's relative dB scale. The combination is
//! a log-sum-exp, so `Tg`/`SMR` stay finite even where `Tq` is very large (the
//! high-frequency end of a wide-band spectrum).

use super::scales::{bark, bark_to_hz};
use super::threshold::threshold_quiet_db;
use crate::audio::analysis::{MaskerInfo, DB_FLOOR};

/// A tonal line must stand this far above every line in its Bark neighbourhood.
const TONAL_PROMINENCE_DB: f32 = 7.0;
/// The Bark radius a tonal line's prominence is tested over.
const TONAL_NEIGHBOURHOOD_BARK: f32 = 1.0;
/// Maskers closer than this on the Bark axis merge (the stronger one is kept).
const MASKER_MERGE_BARK: f32 = 0.5;
/// A window's main lobe spans this many bins either side of its peak. Those bins are
/// the peak's own leakage, not a separate partial, so the prominence test starts two
/// bins away — otherwise a plainly tonal sinusoid would never qualify. They are also
/// the bins summed into a tonal masker's level and into the tonality numerator.
const MAIN_LOBE_BINS: usize = 2;
/// The width of one residual (non-tonal) masker band on the Bark axis. Aggregating a
/// band's non-tonal energy, rather than picking its local maxima, is what lets
/// broadband noise contribute its full masking power.
const NON_TONAL_BAND_BARK: f32 = 0.5;

/// One spectrum's masking model.
#[derive(Debug, Clone)]
pub struct MaskingThresholds {
    /// `Tq(i)` — the threshold in quiet, dB SPL.
    pub threshold_quiet_db: Vec<f32>,
    /// `Tg(i)` — the global masking threshold, in the caller's level unit. It includes
    /// `Tq` only when the caller passed calibrated levels.
    pub global_mask_db: Vec<f32>,
    /// `SMR(i) = L(i) − Tg(i)` (positive = above the estimated threshold).
    pub smr_db: Vec<f32>,
    /// The maskers `global_mask_db` sums over (M36 drill-down), tonal first and then the
    /// residual bands, each named by its centre frequency in Hz.
    pub maskers: Vec<MaskerInfo>,
}

/// One masker's contribution spread from its Bark position.
struct Masker {
    z: f32,
    av: f32,
    level: f32,
    tonal: bool,
}

/// Build every line's `Tq`, `Tg` and `SMR` from one spectrum.
///
/// `levels_db` must be the same length as `freqs`; it is read as dB SPL when
/// `calibrated`, and as a relative (dBFS) level otherwise. `threshold_quiet_db` is
/// always the dB SPL reference curve; when `calibrated` is false it is not part of
/// `Tg`, which is then masker-only and shares the spectrum's relative scale.
pub fn masking_thresholds(freqs: &[f32], levels_db: &[f32], calibrated: bool) -> MaskingThresholds {
    let bins = freqs.len().min(levels_db.len());
    let levels = &levels_db[..bins];
    let positions: Vec<f32> = freqs[..bins].iter().map(|&hz| bark(hz)).collect();
    let (tonal, claimed) = detect_tonal(&positions, levels);

    let mut maskers: Vec<Masker> = tonal
        .iter()
        .map(|&(index, summed)| Masker {
            z: positions[index],
            av: masking_index(positions[index], true),
            level: if summed > 0.0 {
                (10.0 * summed.log10()) as f32
            } else {
                levels[index]
            },
            tonal: true,
        })
        .collect();
    maskers.extend(residual_maskers(&positions, levels, &claimed));
    let masker_info: Vec<MaskerInfo> = maskers
        .iter()
        .map(|masker| MaskerInfo {
            hz: bark_to_hz(masker.z),
            level_db: masker.level,
            tonal: masker.tonal,
        })
        .collect();

    // A coarse grid can leave a line outside every masker's spread: with no ATH to
    // fall back on, use the spectrum's own floor so the threshold stays finite.
    let floor = levels
        .iter()
        .copied()
        .filter(|level| level.is_finite())
        .fold(f32::INFINITY, f32::min);
    let floor = if floor.is_finite() { floor } else { DB_FLOOR };
    let mut quiet_threshold = Vec::with_capacity(bins);
    let mut global_mask_db = Vec::with_capacity(bins);
    let mut smr_db = Vec::with_capacity(bins);
    for (index, &hz) in freqs[..bins].iter().enumerate() {
        let tq = threshold_quiet_db(hz);
        let mut terms: Vec<f32> = Vec::with_capacity(maskers.len() + 1);
        if calibrated {
            terms.push(tq);
        }
        for masker in &maskers {
            let vf = masking_function(positions[index] - masker.z, masker.level);
            if vf.is_finite() {
                terms.push(masker.level + masker.av + vf);
            }
        }
        let tg = match power_sum_db(&terms) {
            tg if tg.is_finite() => tg,
            _ if calibrated => tq,
            _ => floor,
        };
        quiet_threshold.push(tq);
        global_mask_db.push(tg);
        smr_db.push(levels[index] - tg);
    }

    MaskingThresholds {
        threshold_quiet_db: quiet_threshold,
        global_mask_db,
        smr_db,
        maskers: masker_info,
    }
}

/// Linear power of a dB level.
fn power(level_db: f32) -> f64 {
    10f64.powf(f64::from(level_db) / 10.0)
}

/// The power-domain sum of dB `terms`, in dB. A log-sum-exp keeps the result finite
/// even when a term is very large: only the differences to the running maximum are
/// exponentiated, so the sum cannot overflow.
fn power_sum_db(terms: &[f32]) -> f32 {
    let (mut max, mut sum) = (f32::NEG_INFINITY, 0.0f64);
    for &term in terms.iter().filter(|term| term.is_finite()) {
        if term > max {
            sum = sum * 10f64.powf(f64::from(max - term) / 10.0) + 1.0;
            max = term;
        } else {
            sum += 10f64.powf(f64::from(term - max) / 10.0);
        }
    }
    if sum > 0.0 {
        max + (10.0 * sum.log10()) as f32
    } else {
        f32::NEG_INFINITY
    }
}

/// Whether `index` is a local maximum of the level spectrum.
fn is_local_max(levels: &[f32], index: usize) -> bool {
    let level = levels[index];
    if !level.is_finite() {
        return false;
    }
    let previous = index
        .checked_sub(1)
        .and_then(|i| levels.get(i))
        .copied()
        .unwrap_or(f32::NEG_INFINITY);
    let next = levels.get(index + 1).copied().unwrap_or(f32::NEG_INFINITY);
    level > previous && level >= next
}

/// How far `index` stands [`TONAL_PROMINENCE_DB`] above every line in its Bark
/// neighbourhood — i.e. the level minus the loudest line outside the window's own main
/// lobe (`+∞` when the neighbourhood holds no other line).
fn prominence(positions: &[f32], levels: &[f32], index: usize) -> f32 {
    let mut highest = f32::NEG_INFINITY;
    for (other, &other_z) in positions.iter().enumerate() {
        if other == index || other.abs_diff(index) < MAIN_LOBE_BINS {
            continue;
        }
        if (other_z - positions[index]).abs() > TONAL_NEIGHBOURHOOD_BARK {
            continue;
        }
        highest = highest.max(levels[other]);
    }
    levels[index] - highest
}

/// Whether `index` clears the tonal prominence rule (see [`prominence`]).
fn stands_above_neighbours(positions: &[f32], levels: &[f32], index: usize) -> bool {
    prominence(positions, levels, index) >= TONAL_PROMINENCE_DB
}

/// The `tonality` tool's per-frame view: the tonal-energy ratio `H` and the per-line
/// tonal prominence, from **one** Bark mapping and one peak detection.
///
/// `H` is the share of the spectrum's power carried by its tonal components (0…1),
/// summed over each peak's **main lobe** ([`MAIN_LOBE_BINS`] either side) so a bin-centred
/// and a half-bin-centred Hann tone both read close to 1; one peak per [`MASKER_MERGE_BARK`]
/// is retained, so close partials share a component. It is still a peak-picking proxy: a
/// broad spectral bump or a dense harmonic complex is not "tonal" in any perceptual
/// sense.
///
/// The prominence grid is the M36 drill-down: a retained peak carries `level − max(level
/// in its 1-Bark neighbourhood outside the main lobe)`, which is at least
/// [`TONAL_PROMINENCE_DB`] by construction, and every other line is `0` — so a non-zero
/// cell unambiguously marks a detected tonal component and its margin over its
/// neighbours. The rule is the one [`detect_tonal`] applies, not a second copy of it.
pub fn tonality_profile(freqs: &[f32], levels_db: &[f32]) -> (f32, Vec<f32>) {
    let bins = freqs.len().min(levels_db.len());
    let levels = &levels_db[..bins];
    let positions: Vec<f32> = freqs[..bins].iter().map(|&hz| bark(hz)).collect();
    let (tonal, _) = detect_tonal(&positions, levels);
    let total: f64 = levels.iter().map(|&level| power(level)).sum();
    let fraction = if total <= 0.0 {
        0.0
    } else {
        (tonal.iter().map(|&(_, power)| power).sum::<f64>() / total).min(1.0) as f32
    };
    let mut prominence_db = vec![0.0f32; bins];
    for (index, _) in tonal {
        let margin = prominence(&positions, levels, index);
        // A spectrum only a few lines wide can leave a peak with nothing in its
        // neighbourhood but its own main lobe. It still qualifies as tonal, but the grid
        // reports a finite margin (the line's height above the analysis floor) rather
        // than `+∞`, which JSON cannot carry.
        prominence_db[index] = if margin.is_finite() {
            margin
        } else {
            levels[index] - DB_FLOOR
        };
    }
    (fraction, prominence_db)
}

/// The tonal candidates: interior local maxima with the required prominence. The
/// first and last retained bins are band edges (DC / Nyquist), not complete peaks.
fn tonal_candidates(positions: &[f32], levels: &[f32]) -> Vec<usize> {
    (1..levels.len().saturating_sub(1))
        .filter(|&index| {
            is_local_max(levels, index) && stands_above_neighbours(positions, levels, index)
        })
        .collect()
}

/// Merge maskers within [`MASKER_MERGE_BARK`] of a stronger one, keeping the strongest.
fn decimate(positions: &[f32], levels: &[f32], mut candidates: Vec<usize>) -> Vec<usize> {
    candidates.sort_by(|&a, &b| levels[b].total_cmp(&levels[a]));
    let mut kept: Vec<usize> = Vec::new();
    for index in candidates {
        let z = positions[index];
        if kept
            .iter()
            .all(|&other| (positions[other] - z).abs() >= MASKER_MERGE_BARK)
        {
            kept.push(index);
        }
    }
    kept.sort_unstable();
    kept
}

/// The retained tonal peaks and their main-lobe components (peak bin, summed power),
/// strongest first, plus the bins those lobes claim. A bin in overlapping lobes is
/// counted once, by the stronger peak, so the tonality numerator cannot double-count
/// shared leakage.
fn detect_tonal(positions: &[f32], levels: &[f32]) -> (Vec<(usize, f64)>, Vec<bool>) {
    let mut peaks = decimate(positions, levels, tonal_candidates(positions, levels));
    peaks.sort_by(|&a, &b| levels[b].total_cmp(&levels[a]));
    let mut claimed = vec![false; levels.len()];
    let last = levels.len().saturating_sub(1);
    let mut components = Vec::with_capacity(peaks.len());
    for index in peaks {
        let mut summed = 0.0;
        for bin in index.saturating_sub(MAIN_LOBE_BINS)..=(index + MAIN_LOBE_BINS).min(last) {
            if !claimed[bin] {
                claimed[bin] = true;
                summed += power(levels[bin]);
            }
        }
        components.push((index, summed));
    }
    (components, claimed)
}

/// The non-tonal maskers: the residual (unclaimed) power grouped into bands about
/// [`NON_TONAL_BAND_BARK`] wide. Each masker sits at its band's power-weighted Bark
/// position and carries the band's summed level, so a broadband noise contributes a
/// whole band's energy rather than only bands that happen to hold a local maximum.
fn residual_maskers(positions: &[f32], levels: &[f32], claimed: &[bool]) -> Vec<Masker> {
    // `(band index, summed power, power-weighted Bark position)`, in spectrum order.
    let mut bands: Vec<(i32, f64, f64)> = Vec::new();
    for (index, &z) in positions.iter().enumerate() {
        if claimed.get(index).copied().unwrap_or(false) || !z.is_finite() {
            continue;
        }
        let band_power = power(levels[index]);
        if band_power <= 0.0 {
            continue;
        }
        let band = (z / NON_TONAL_BAND_BARK).floor() as i32;
        match bands.last_mut() {
            Some((current, power, weighted)) if *current == band => {
                *power += band_power;
                *weighted += band_power * f64::from(z);
            }
            _ => bands.push((band, band_power, band_power * f64::from(z))),
        }
    }
    bands
        .into_iter()
        .filter(|&(_, power, _weighted)| power > 0.0)
        .map(|(_, power, weighted)| {
            let z = (weighted / power) as f32;
            Masker {
                z,
                av: masking_index(z, false),
                level: (10.0 * power.log10()) as f32,
                tonal: false,
            }
        })
        .collect()
}

/// The masking index `av` (dB) of a masker at Bark position `z`.
fn masking_index(z: f32, tonal: bool) -> f32 {
    if tonal {
        -1.525 - 0.275 * z - 4.5
    } else {
        -1.525 - 0.175 * z - 0.5
    }
}

/// The Bark-distance masking function `vf(dz, X)`, `-inf` outside `[-3, 8)`.
fn masking_function(dz: f32, level: f32) -> f32 {
    if (-3.0..-1.0).contains(&dz) {
        17.0 * (dz + 1.0) - (0.4 * level + 6.0)
    } else if (-1.0..0.0).contains(&dz) {
        (0.4 * level + 6.0) * dz
    } else if (0.0..1.0).contains(&dz) {
        -17.0 * dz
    } else if (1.0..8.0).contains(&dz) {
        -(dz - 1.0) * (17.0 - 0.15 * level) - 17.0
    } else {
        f32::NEG_INFINITY
    }
}

#[cfg(test)]
mod tests;
