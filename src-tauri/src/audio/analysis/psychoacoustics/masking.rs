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
//! Maskers are the spectrum's **tonal** peaks (local maxima that stand at least 7 dB
//! above the lines in their Bark neighbourhood) and its remaining **non-tonal** local
//! maxima; maskers within 0.5 Bark of a stronger one are merged. The two masker types
//! use the published MPEG-style masking-index and spreading-function constants.
//!
//! This is the model a codec's psychoacoustic analysis uses, not a universal predictor
//! of human detection: the reference curves assume a quiet context, the shared window
//! and the supplied calibration. A level is a dB SPL only when the caller passes the
//! calibrated spectrum; otherwise the result is labelled as dBFS.

use super::scales::bark;
use super::threshold::threshold_quiet_db;

/// A tonal line must stand this far above every line in its Bark neighbourhood.
const TONAL_PROMINENCE_DB: f32 = 7.0;
/// The Bark radius a tonal line's prominence is tested over.
const TONAL_NEIGHBOURHOOD_BARK: f32 = 1.0;
/// Maskers closer than this on the Bark axis merge (the stronger one is kept).
const MASKER_MERGE_BARK: f32 = 0.5;
/// A window's main lobe spans this many bins either side of its peak. Those bins are
/// the peak's own leakage, not a separate partial, so the prominence test starts two
/// bins away — otherwise a plainly tonal sinusoid would never qualify.
const MAIN_LOBE_BINS: usize = 2;

/// One spectrum's masking model.
#[derive(Debug, Clone)]
pub struct MaskingThresholds {
    /// `Tq(i)` — the threshold in quiet, dB SPL.
    pub threshold_quiet_db: Vec<f32>,
    /// `Tg(i)` — the global masking threshold, in the caller's level unit.
    pub global_mask_db: Vec<f32>,
    /// `SMR(i) = L(i) − Tg(i)` (positive = above the estimated threshold).
    pub smr_db: Vec<f32>,
}

/// One masker's contribution spread from its Bark position.
struct Masker {
    z: f32,
    av: f32,
    level: f32,
}

/// Build every line's `Tq`, `Tg` and `SMR` from one spectrum.
///
/// `levels_db` must be the same length as `freqs`; it is read as dB SPL when the
/// caller calibrated the spectrum, and as dBFS otherwise. `Tq` is always dB SPL, so an
/// uncalibrated result mixes the two scales by construction — the caller labels it.
pub fn masking_thresholds(freqs: &[f32], levels_db: &[f32]) -> MaskingThresholds {
    let bins = freqs.len().min(levels_db.len());
    let levels = &levels_db[..bins];
    let (positions, tonal_lines, tonal) = bark_positions_and_tonals(&freqs[..bins], levels);
    let non_tonal = decimate(
        &positions,
        levels,
        non_tonal_candidates(levels, &tonal_lines),
    );

    let maskers: Vec<Masker> = tonal
        .iter()
        .map(|&index| Masker {
            z: positions[index],
            av: masking_index(positions[index], true),
            level: levels[index],
        })
        .chain(non_tonal.iter().map(|&index| Masker {
            z: positions[index],
            av: masking_index(positions[index], false),
            level: levels[index],
        }))
        .collect();

    let mut quiet_threshold = Vec::with_capacity(bins);
    let mut global_mask_db = Vec::with_capacity(bins);
    let mut smr_db = Vec::with_capacity(bins);
    for (index, &hz) in freqs[..bins].iter().enumerate() {
        let tq = threshold_quiet_db(hz);
        let mut power = 10f64.powf(f64::from(tq) / 10.0);
        for masker in &maskers {
            let dz = positions[index] - masker.z;
            let vf = masking_function(dz, masker.level);
            if vf.is_finite() {
                let individual = f64::from(masker.level + masker.av + vf);
                power += 10f64.powf(individual / 10.0);
            }
        }
        let tg = (10.0 * power.log10()) as f32;
        quiet_threshold.push(tq);
        global_mask_db.push(tg);
        smr_db.push(levels[index] - tg);
    }

    MaskingThresholds {
        threshold_quiet_db: quiet_threshold,
        global_mask_db,
        smr_db,
    }
}

/// The share of a spectrum's power in bins classified tonal (0…1), from the same
/// detection [`masking_thresholds`] uses — the `tonality` tool's per-frame value.
pub fn tonal_energy_fraction(freqs: &[f32], levels_db: &[f32]) -> f32 {
    let bins = freqs.len().min(levels_db.len());
    let levels = &levels_db[..bins];
    let (_, _, tonal) = bark_positions_and_tonals(&freqs[..bins], levels);
    let total: f64 = levels.iter().map(|&level| power(level)).sum();
    if total <= 0.0 {
        return 0.0;
    }
    let tonal_power: f64 = tonal.iter().map(|&index| power(levels[index])).sum();
    (tonal_power / total).min(1.0) as f32
}

/// The Bark positions of the lines, their tonal candidates, and the decimated tonal
/// maskers (strongest per 0.5 Bark).
fn bark_positions_and_tonals(freqs: &[f32], levels: &[f32]) -> (Vec<f32>, Vec<usize>, Vec<usize>) {
    let positions: Vec<f32> = freqs.iter().map(|&hz| bark(hz)).collect();
    let candidates = tonal_candidates(&positions, levels);
    let tonal = decimate(&positions, levels, candidates.clone());
    (positions, candidates, tonal)
}

/// Linear power of a dB level.
fn power(level_db: f32) -> f64 {
    10f64.powf(f64::from(level_db) / 10.0)
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

/// Whether `index` stands [`TONAL_PROMINENCE_DB`] above every line in its Bark
/// neighbourhood (outside the window's own main lobe).
fn stands_above_neighbours(positions: &[f32], levels: &[f32], index: usize) -> bool {
    let z = positions[index];
    for (other, &other_z) in positions.iter().enumerate() {
        if other == index || other.abs_diff(index) < MAIN_LOBE_BINS {
            continue;
        }
        if (other_z - z).abs() > TONAL_NEIGHBOURHOOD_BARK {
            continue;
        }
        if levels[index] - levels[other] < TONAL_PROMINENCE_DB {
            return false;
        }
    }
    true
}

/// The interior bins. The first and last retained bins are edges of the analysed
/// band (DC / Nyquist), not maskers with a complete neighbourhood.
fn interior(levels: &[f32]) -> std::ops::Range<usize> {
    1..levels.len().saturating_sub(1)
}

fn tonal_candidates(positions: &[f32], levels: &[f32]) -> Vec<usize> {
    interior(levels)
        .filter(|&index| {
            is_local_max(levels, index) && stands_above_neighbours(positions, levels, index)
        })
        .collect()
}

/// The remaining local maxima — the non-tonal (noise-like) maskers.
fn non_tonal_candidates(levels: &[f32], tonal: &[usize]) -> Vec<usize> {
    interior(levels)
        .filter(|&index| is_local_max(levels, index) && !tonal.contains(&index))
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
mod tests {
    use super::*;

    /// 100 Hz-spaced bins from 100 Hz to 5 kHz.
    fn freqs() -> Vec<f32> {
        (1..=50).map(|bin| bin as f32 * 100.0).collect()
    }

    #[test]
    fn the_global_threshold_never_falls_below_the_threshold_in_quiet() {
        let freqs = freqs();
        let levels: Vec<f32> = freqs.iter().map(|_| -20.0).collect();
        let model = masking_thresholds(&freqs, &levels);
        assert_eq!(model.threshold_quiet_db.len(), freqs.len());
        for (index, (&tq, &tg)) in model
            .threshold_quiet_db
            .iter()
            .zip(&model.global_mask_db)
            .enumerate()
        {
            assert!(tg >= tq, "bin {index}: Tg {tg} < Tq {tq}");
            assert!((tg - model.global_mask_db[index]).abs() < 1e-6);
        }
    }

    #[test]
    fn a_clear_peak_is_tonal_and_a_flat_spectrum_is_not() {
        let freqs = freqs();
        let flat: Vec<f32> = freqs.iter().map(|_| -60.0).collect();
        assert_eq!(tonal_energy_fraction(&freqs, &flat), 0.0);

        let mut peaked = flat.clone();
        let index = freqs.iter().position(|&hz| hz == 1_000.0).expect("1 kHz");
        peaked[index] = -10.0;
        let fraction = tonal_energy_fraction(&freqs, &peaked);
        assert!(
            fraction > 0.5,
            "a single dominant line is {fraction:.3} tonal, expected > 0.5"
        );
    }

    #[test]
    fn the_masking_function_is_bounded_to_its_piecewise_range() {
        assert!(masking_function(-3.5, 60.0).is_infinite());
        assert!(masking_function(8.0, 60.0).is_infinite());
        assert!(masking_function(0.0, 60.0).is_finite());
        // Upward spread fades with distance; the far side of a masker masks less.
        assert!(masking_function(2.0, 60.0) < masking_function(0.5, 60.0));
    }
}
