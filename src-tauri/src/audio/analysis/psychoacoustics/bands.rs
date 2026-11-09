//! Critical-band edges and per-band energy (M26).
//!
//! [`critical_band_edges`] builds near-1-scale-unit bands over a frequency range,
//! and [`band_energies`] sums STFT power inside each band. Both are shared by the
//! `criticalBands` analyzer and the perceptual models that follow.

use super::super::support::db_or_floor;
use super::scales::{bark, bark_to_hz, cam, cam_to_hz, Scale};

/// Band-count caps over the audible range: Bark ≈ 24, ERB ≈ 40.
const MAX_BARK_BANDS: usize = 24;
const MAX_ERB_BANDS: usize = 40;

/// The monotone scale position of `hz` on `scale`.
fn position(scale: Scale, hz: f32) -> f32 {
    match scale {
        Scale::Bark => bark(hz),
        Scale::Erb => cam(hz),
    }
}

/// Frequency (Hz) at scale position `z`.
fn to_hz(scale: Scale, z: f32) -> f32 {
    match scale {
        Scale::Bark => bark_to_hz(z),
        Scale::Erb => cam_to_hz(z),
    }
}

/// `n + 1` non-decreasing band edges (Hz) covering `[min_hz, max_hz]`.
///
/// Edges advance by about one scale unit (1 Bark / 1 Cam), so there are roughly
/// `span` bands; a wide range is coarsened uniformly to stay inside the model's
/// cap ([`MAX_BARK_BANDS`] / [`MAX_ERB_BANDS`]). A range narrower than one band —
/// including a zero-width range — still yields a single, clamped band.
///
/// The geometry is derived from the **requested** range, so it is not the fixed
/// standardized Bark/ERB boundary table: narrowing or shifting the range changes
/// the partition rather than merely hiding rows.
pub fn critical_band_edges(scale: Scale, min_hz: f32, max_hz: f32) -> Vec<f32> {
    let min_hz = if min_hz.is_finite() {
        min_hz.max(0.0)
    } else {
        0.0
    };
    let max_hz = if max_hz.is_finite() {
        max_hz.max(min_hz)
    } else {
        min_hz
    };

    let low = position(scale, min_hz).max(0.0);
    let high = position(scale, max_hz).max(low);
    let span = high - low;
    let cap = match scale {
        Scale::Bark => MAX_BARK_BANDS,
        Scale::Erb => MAX_ERB_BANDS,
    };
    let bands = if span > 0.0 {
        (span.ceil() as usize).clamp(1, cap)
    } else {
        1
    };
    let step = span / bands as f32;

    (0..=bands)
        .map(|index| to_hz(scale, low + step * index as f32).clamp(min_hz, max_hz))
        .collect()
}

/// Per-frame band levels in dBFS (`frame × band`).
///
/// Each band sums the **power** (`magnitude²`) of the bins whose frequency falls
/// inside it, then converts back with `20 log10(sqrt(sum))`, floored at the
/// analysis `DB_FLOOR` so silence stays finite and JSON-safe.
///
/// Despite the historical "energy" name, a value is the band's summed spectral
/// power on the digital full-scale reference — not joules, not an energy density,
/// and not a power spectral density (dB/Hz).
pub fn band_energies(
    magnitudes_per_frame: &[Vec<f32>],
    freqs: &[f32],
    edges: &[f32],
) -> Vec<Vec<f32>> {
    let Some(bands) = edges.len().checked_sub(1).filter(|&bands| bands > 0) else {
        return vec![Vec::new(); magnitudes_per_frame.len()];
    };
    magnitudes_per_frame
        .iter()
        .map(|magnitudes| {
            let mut power = vec![0.0f64; bands];
            for (bin, &magnitude) in magnitudes.iter().enumerate() {
                let Some(&frequency) = freqs.get(bin) else {
                    break;
                };
                let Some(band) = band_index(edges, frequency) else {
                    continue;
                };
                power[band] += f64::from(magnitude) * f64::from(magnitude);
            }
            power
                .into_iter()
                .map(|sum| db_or_floor(20.0 * (sum as f32).sqrt().log10()))
                .collect()
        })
        .collect()
}

/// The band whose `[edge, edge + 1)` interval holds `frequency`, with the top
/// edge included in the last band.
fn band_index(edges: &[f32], frequency: f32) -> Option<usize> {
    let first = *edges.first()?;
    let last = *edges.last()?;
    let bands = edges.len().checked_sub(1)?;
    if bands == 0 || !frequency.is_finite() || frequency < first || frequency > last {
        return None;
    }
    let index = edges
        .partition_point(|&edge| edge <= frequency)
        .saturating_sub(1);
    Some(index.min(bands - 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bands(scale: Scale, min_hz: f32, max_hz: f32) -> Vec<f32> {
        critical_band_edges(scale, min_hz, max_hz)
    }

    #[test]
    fn edges_are_monotonic_and_cover_the_range() {
        for scale in [Scale::Bark, Scale::Erb] {
            let edges = bands(scale, 100.0, 12_000.0);
            assert!(edges.len() >= 2, "{scale:?}: no bands");
            assert!(
                edges.windows(2).all(|pair| pair[1] >= pair[0]),
                "{scale:?}: edges are not monotonic: {edges:?}"
            );
            assert!(
                edges.first().is_some_and(|&f| f <= 100.5),
                "{scale:?}: first edge does not reach the range start: {edges:?}"
            );
            assert!(
                edges.last().is_some_and(|&f| f >= 11_999.5),
                "{scale:?}: last edge does not reach the range end: {edges:?}"
            );
        }
    }

    #[test]
    fn a_one_khz_sine_lands_in_the_band_containing_it() {
        let freqs: Vec<f32> = (0..=100).map(|bin| bin as f32 * 100.0).collect();
        let mut magnitudes = vec![0.0f32; freqs.len()];
        magnitudes[10] = 1.0; // the 1 kHz bin
        let edges = bands(Scale::Bark, 0.0, 10_000.0);
        let energies = band_energies(&[magnitudes], &freqs, &edges);
        assert_eq!(energies.len(), 1);
        assert_eq!(energies[0].len(), edges.len() - 1);

        let (peak, &level) = energies[0]
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .expect("a peak band");
        assert!(
            1_000.0 >= edges[peak] && 1_000.0 <= edges[peak + 1],
            "peak band [{}, {}] does not contain 1 kHz",
            edges[peak],
            edges[peak + 1]
        );
        // A unit magnitude is 0 dBFS; every other band is empty and floored.
        assert!((level - 0.0).abs() < 1e-3, "peak level = {level}");
        assert!(energies[0]
            .iter()
            .enumerate()
            .all(|(band, &value)| band == peak || value <= -119.0));
    }

    #[test]
    fn bark_and_erb_have_different_band_counts() {
        let bark = bands(Scale::Bark, 0.0, 20_000.0);
        let erb = bands(Scale::Erb, 0.0, 20_000.0);
        assert!(bark.len() - 1 <= MAX_BARK_BANDS);
        assert!(erb.len() - 1 <= MAX_ERB_BANDS);
        assert_ne!(bark.len(), erb.len());
    }

    #[test]
    fn a_narrow_range_clamps_to_one_band() {
        for scale in [Scale::Bark, Scale::Erb] {
            let edges = bands(scale, 100.0, 200.0);
            assert!(edges.len() >= 2, "{scale:?}: no bands");
            assert!(edges.iter().all(|&f| (100.0..=200.0).contains(&f)));
            // A zero-width request still yields one band rather than panicking.
            let degenerate = bands(scale, 100.0, 100.0);
            assert_eq!(degenerate.len(), 2);
        }
    }
}
