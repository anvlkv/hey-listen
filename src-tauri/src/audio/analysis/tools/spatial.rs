//! The `spatial` analyzer (M31): mid/side levels and inter-channel correlation.
//!
//! Unlike every other tool, this reads channels 0 and 1 of the **interleaved** window
//! *before* `SharedParams::channel` selects or mixes down — a documented exception.
//! It therefore needs a stereo source and rejects a mono one.
//!
//! The series is the normalized correlation `ρ_LR` per frame; the window-level mid
//! `(L + R) / 2` and side `(L − R) / 2` RMS are dBFS readouts. These are **acoustic
//! cues**, not a perceived-width model: width also depends on playback configuration
//! and listening conditions.
//!
//! **Calibration is recorded, not applied.** `calibrationDbSpl` tags the run the way
//! the other perception tools do, but it does not turn these cues into dB SPL: the
//! correlation is unitless and mid/side are inter-channel amplitude ratios, so an
//! absolute-level calibration has nothing to scale. Read the levels as dBFS whatever
//! the calibration says.

use super::super::psychoacoustics::mid_side;
use super::super::support::{db_or_floor, frame_times};
use super::super::{AnalysisError, SharedParams, SpatialResult, ToolOptions, DB_FLOOR};
use crate::audio::graph::{self, GraphSpec};
use crate::audio::pcm;

/// Cap on the correlation frames a long window returns (IPC size bound).
const MAX_SPATIAL_FRAMES: usize = 4_096;
/// Correlation frame length, in ms (enough samples for a stable estimate).
const SPATIAL_FRAME_MS: f32 = 20.0;
/// Step between correlation frames, in ms.
const SPATIAL_HOP_MS: f32 = 10.0;

/// Mid/side levels and the normalized inter-channel correlation over the window.
///
/// `region` is the interleaved sliced window; `channels` must be at least 2. The
/// filter runs on the left and right channels independently, then both are resampled
/// to `params.resample_to` when it is set. The calibration option is copied into the
/// result for provenance only — it never scales the dBFS mid/side levels.
pub(crate) fn spatial(
    region: &[f32],
    channels: u16,
    sample_rate: u32,
    filter: Option<&GraphSpec>,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<SpatialResult, AnalysisError> {
    let channels = channels.max(1) as usize;
    if channels < 2 {
        return Err(AnalysisError::Analysis(
            "spatial needs a stereo (2-channel) source".to_string(),
        ));
    }
    let rate_in = sample_rate.max(1);
    let frames = region.len() / channels;
    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    for frame in 0..frames {
        let base = frame * channels;
        left.push(region[base]);
        right.push(region[base + 1]);
    }

    let (left, right) = match filter {
        Some(spec) => (
            graph::apply_mono(spec, &left, rate_in)
                .map_err(|err| AnalysisError::Filter(err.to_string()))?,
            graph::apply_mono(spec, &right, rate_in)
                .map_err(|err| AnalysisError::Filter(err.to_string()))?,
        ),
        None => (left, right),
    };
    let rate = params
        .resample_to
        .map(|to| to.clamp(8_000, 384_000))
        .unwrap_or(rate_in);
    let left = pcm::resample_linear(&left, rate_in, rate);
    let right = pcm::resample_linear(&right, rate_in, rate);

    let mid_db = rms_db(&mid(&left, &right));
    let side_db = rms_db(&side(&left, &right));

    let rate_f = rate as f32;
    let frame = ((SPATIAL_FRAME_MS / 1000.0) * rate_f).round().max(2.0) as usize;
    let requested_hop = ((SPATIAL_HOP_MS / 1000.0) * rate_f).round().max(1.0) as usize;
    let hop = requested_hop.max(left.len().div_ceil(MAX_SPATIAL_FRAMES).max(1));
    let len = left.len();
    let mut values = Vec::new();
    let mut start = 0usize;
    while start < len {
        let end = (start + frame).min(len);
        values.push(mid_side::correlation(&left[start..end], &right[start..end]));
        if end >= len {
            break;
        }
        start += hop;
    }

    let (mut min, mut max) = (f32::INFINITY, f32::NEG_INFINITY);
    for value in values.iter().flatten() {
        min = min.min(*value);
        max = max.max(*value);
    }
    let calibration = options.calibration_db_spl();
    Ok(SpatialResult {
        sample_rate: rate,
        hop_size: hop,
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        times: frame_times(values.len(), hop, rate),
        values,
        min_value: if min.is_finite() { min } else { 0.0 },
        max_value: if max.is_finite() { max } else { 0.0 },
        mid_db,
        side_db,
        calibrated: calibration > 0.0,
        calibration_db_spl: calibration,
    })
}

/// The mid `(L + R) / 2` track.
fn mid(left: &[f32], right: &[f32]) -> Vec<f32> {
    left.iter()
        .zip(right)
        .map(|(&l, &r)| mid_side::mid_side(l, r).0)
        .collect()
}

/// The side `(L − R) / 2` track.
fn side(left: &[f32], right: &[f32]) -> Vec<f32> {
    left.iter()
        .zip(right)
        .map(|(&l, &r)| mid_side::mid_side(l, r).1)
        .collect()
}

/// RMS in dBFS, floored so silence stays finite.
fn rms_db(samples: &[f32]) -> f32 {
    let rms = mid_side::rms(samples);
    let db = if rms > 0.0 {
        20.0 * (rms as f32).log10()
    } else {
        DB_FLOOR
    };
    db_or_floor(db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::analysis::tests::{params, tone, RATE};

    /// Interleave a left/right pair into a stereo region.
    fn stereo(left: &[f32], right: &[f32]) -> Vec<f32> {
        let mut region = Vec::with_capacity(left.len() * 2);
        for (&l, &r) in left.iter().zip(right) {
            region.push(l);
            region.push(r);
        }
        region
    }

    #[test]
    fn a_hard_panned_signal_has_equal_mid_and_side_energy() {
        let signal = tone(0.5, 440.0, 0.2);
        let region = stereo(&signal, &vec![0.0; signal.len()]);
        let result = spatial(
            &region,
            2,
            RATE,
            None,
            &params(2_048),
            &ToolOptions::default(),
        )
        .expect("spatial");

        assert!(!result.values.is_empty());
        assert!(
            (result.mid_db - result.side_db).abs() < 0.5,
            "mid {} dBFS vs side {} dBFS",
            result.mid_db,
            result.side_db
        );
        // One channel is silent: the normalized correlation is 0, not undefined.
        assert!(
            result.values.iter().flatten().all(|rho| rho.abs() < 1e-3),
            "correlation = {:?}",
            result.values
        );
    }

    #[test]
    fn an_identical_pair_is_correlated_with_no_side_energy() {
        let signal = tone(0.5, 440.0, 0.2);
        let region = stereo(&signal, &signal);
        let result = spatial(
            &region,
            2,
            RATE,
            None,
            &params(2_048),
            &ToolOptions::default(),
        )
        .expect("spatial");

        assert!(!result.values.is_empty());
        let min = result
            .values
            .iter()
            .flatten()
            .copied()
            .fold(f32::INFINITY, f32::min);
        assert!(min > 0.99, "minimum correlation = {min}");
        assert_eq!(result.side_db, DB_FLOOR, "side = {} dBFS", result.side_db);
        assert!(result.mid_db > DB_FLOOR);
    }

    #[test]
    fn a_mono_source_is_rejected() {
        let signal = tone(0.5, 440.0, 0.1);
        let error = spatial(
            &signal,
            1,
            RATE,
            None,
            &params(2_048),
            &ToolOptions::default(),
        )
        .expect_err("mono must fail");
        assert!(error.to_string().contains("stereo"), "error = {error}");
    }

    fn min_correlation(result: &SpatialResult) -> f32 {
        result
            .values
            .iter()
            .flatten()
            .copied()
            .fold(f32::INFINITY, f32::min)
    }

    fn max_correlation(result: &SpatialResult) -> f32 {
        result
            .values
            .iter()
            .flatten()
            .copied()
            .fold(f32::NEG_INFINITY, f32::max)
    }

    #[test]
    fn an_anti_phase_pair_is_negatively_correlated() {
        let left = tone(0.4, 300.0, 0.2);
        let right: Vec<f32> = left.iter().map(|&sample| -sample).collect();
        let region = stereo(&left, &right);
        let result = spatial(
            &region,
            2,
            RATE,
            None,
            &params(2_048),
            &ToolOptions::default(),
        )
        .expect("spatial");

        assert!(!result.values.is_empty());
        let max = max_correlation(&result);
        assert!(max < -0.99, "maximum correlation = {max}");
        // Anti-phase cancels in the mid exactly and adds in the side.
        assert_eq!(result.mid_db, DB_FLOOR, "mid = {} dBFS", result.mid_db);
        assert!(result.side_db > DB_FLOOR, "side = {} dBFS", result.side_db);
    }

    #[test]
    fn an_unequal_pair_stays_correlated_and_splits_the_levels() {
        // The same tone at half the amplitude on the right: ρ stays 1 while the
        // mid/side levels follow the 3:1 amplitude ratio (20 log10 3 ≈ 9.54 dB).
        let left = tone(0.4, 440.0, 0.2);
        let right: Vec<f32> = left.iter().map(|&sample| sample * 0.5).collect();
        let region = stereo(&left, &right);
        let result = spatial(
            &region,
            2,
            RATE,
            None,
            &params(2_048),
            &ToolOptions::default(),
        )
        .expect("spatial");

        let min = min_correlation(&result);
        assert!(min > 0.99, "minimum correlation = {min}");
        let split = result.mid_db - result.side_db;
        assert!(
            (split - 9.54).abs() < 0.3,
            "mid {} dBFS vs side {} dBFS is {split} dB apart",
            result.mid_db,
            result.side_db
        );
    }

    #[test]
    fn independent_channels_are_uncorrelated() {
        // Different harmonics of 300 Hz are orthogonal over each 20 ms frame.
        let left = tone(0.4, 300.0, 0.2);
        let right = tone(0.4, 3_000.0, 0.2);
        let region = stereo(&left, &right);
        let result = spatial(
            &region,
            2,
            RATE,
            None,
            &params(2_048),
            &ToolOptions::default(),
        )
        .expect("spatial");

        assert!(
            result.values.iter().flatten().all(|rho| rho.abs() < 0.1),
            "correlation = {:?}",
            result.values
        );
    }

    #[test]
    fn resampling_both_channels_leaves_the_cues_intact() {
        let signal = tone(0.4, 440.0, 0.2);
        let region = stereo(&signal, &signal);
        let plain = spatial(
            &region,
            2,
            RATE,
            None,
            &params(2_048),
            &ToolOptions::default(),
        )
        .expect("spatial");

        let mut resampled_params = params(2_048);
        resampled_params.resample_to = Some(22_050);
        let resampled = spatial(
            &region,
            2,
            RATE,
            None,
            &resampled_params,
            &ToolOptions::default(),
        )
        .expect("spatial");

        assert_eq!(resampled.sample_rate, 22_050);
        let min = min_correlation(&resampled);
        assert!(min > 0.99, "resampled minimum correlation = {min}");
        assert!(
            (resampled.mid_db - plain.mid_db).abs() < 0.5,
            "mid {} dBFS un-resampled vs {} dBFS resampled",
            plain.mid_db,
            resampled.mid_db
        );
    }
}
