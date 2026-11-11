//! The postcard-safe stored form of a [`CalibratedSeriesResult`] (M36).
//!
//! See [`super::stored`] for the positional-wrapper rationale. The trailing
//! `contribution` grid and then the `rate_contribution` matrix are appended after the
//! original nine fields, so a file written before either existed still decodes:
//! `postcard` is positional, so the reader defaults each trailing field when the buffer
//! ends early (a pre-M36 file, never a corrupt value — the file's checksum rules that
//! out).

use serde::{Deserialize, Serialize};

use super::decode::Fields;
use crate::audio::analysis::{CalibratedSeriesResult, Contribution, RateContribution};

/// The postcard-safe stored fields of a [`CalibratedSeriesResult`].
#[derive(Clone, Serialize)]
pub struct StoredCalibratedSeries {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub window_start: f64,
    pub times: Vec<f32>,
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    pub calibrated: bool,
    pub calibration_db_spl: f32,
    pub contribution: Option<Contribution>,
    pub rate_contribution: Option<RateContribution>,
}

impl<'de> Deserialize<'de> for StoredCalibratedSeries {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct SeriesVisitor;
        impl<'de> serde::de::Visitor<'de> for SeriesVisitor {
            type Value = StoredCalibratedSeries;

            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("a calibrated series result")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut f: Fields<'_, 'de, A> = Fields::new(&mut seq, "a calibrated series result");
                Ok(StoredCalibratedSeries {
                    sample_rate: f.req()?,
                    hop_size: f.req()?,
                    window_start: f.req()?,
                    times: f.req()?,
                    values: f.req()?,
                    min_value: f.req()?,
                    max_value: f.req()?,
                    calibrated: f.req()?,
                    calibration_db_spl: f.req()?,
                    // The M36 contribution grid: a file written before it ends here.
                    contribution: f.opt(),
                    // The M36 band × rate matrix, appended after the contribution grid.
                    rate_contribution: f.opt(),
                })
            }
        }
        deserializer.deserialize_tuple(11, SeriesVisitor)
    }
}

impl std::fmt::Debug for StoredCalibratedSeries {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        CalibratedSeriesResult::from(self.clone()).fmt(f)
    }
}

impl From<&CalibratedSeriesResult> for StoredCalibratedSeries {
    fn from(r: &CalibratedSeriesResult) -> Self {
        Self {
            sample_rate: r.sample_rate,
            hop_size: r.hop_size,
            window_start: r.window_start,
            times: r.times.clone(),
            values: r.values.clone(),
            min_value: r.min_value,
            max_value: r.max_value,
            calibrated: r.calibrated,
            calibration_db_spl: r.calibration_db_spl,
            contribution: r.contribution.clone(),
            rate_contribution: r.rate_contribution.clone(),
        }
    }
}

impl From<StoredCalibratedSeries> for CalibratedSeriesResult {
    fn from(stored: StoredCalibratedSeries) -> Self {
        Self {
            sample_rate: stored.sample_rate,
            hop_size: stored.hop_size,
            window_start: stored.window_start,
            times: stored.times,
            values: stored.values,
            min_value: stored.min_value,
            max_value: stored.max_value,
            calibrated: stored.calibrated,
            calibration_db_spl: stored.calibration_db_spl,
            contribution: stored.contribution,
            rate_contribution: stored.rate_contribution,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::StoredCalibratedSeries;
    use crate::audio::analysis::{fixtures, CalibratedSeriesResult, Contribution};

    #[test]
    fn a_series_with_its_grids_round_trips_through_postcard() {
        let series = fixtures::series_with_rates();
        let bytes = postcard::to_stdvec(&StoredCalibratedSeries::from(&series)).expect("encode");
        let decoded = postcard::from_bytes::<StoredCalibratedSeries>(&bytes).expect("decode");
        let round = CalibratedSeriesResult::from(decoded);
        round
            .rate_contribution
            .as_ref()
            .expect("a rate matrix")
            .assert_consistent();
        assert_eq!(
            serde_json::to_value(&round).expect("json"),
            serde_json::to_value(&series).expect("json"),
        );
    }

    #[test]
    fn a_pre_contribution_series_decodes_with_defaults() {
        // The stored form before M36 was the original nine fields; `postcard` is
        // positional, so a plain tuple reproduces those bytes exactly. The reader then
        // defaults `contribution` instead of failing the load.
        type PreContribution = (
            u32,
            usize,
            f64,
            Vec<f32>,
            Vec<Option<f32>>,
            f32,
            f32,
            bool,
            f32,
        );
        let old: PreContribution = (
            48_000,
            480,
            0.0,
            vec![0.0, 0.01],
            vec![Some(1.0), None],
            1.0,
            1.0,
            true,
            94.0,
        );
        let bytes = postcard::to_stdvec(&old).expect("encode pre-contribution");
        let stored: StoredCalibratedSeries =
            postcard::from_bytes(&bytes).expect("decode pre-contribution");
        let series = CalibratedSeriesResult::from(stored);
        assert!(series.contribution.is_none());
        assert_eq!(series.values, vec![Some(1.0), None]);
        assert!(series.calibrated);
    }

    #[test]
    fn a_pre_rate_contribution_series_decodes_with_defaults() {
        // The stored form after the contribution grid, before the M36 band × rate
        // matrix, was this ten-field tuple; `postcard` is positional, so encoding it
        // reproduces those bytes exactly. The reader then defaults `rateContribution`
        // (and keeps the contribution grid) instead of failing the load.
        type PreRateContribution = (
            u32,
            usize,
            f64,
            Vec<f32>,
            Vec<Option<f32>>,
            f32,
            f32,
            bool,
            f32,
            Option<Contribution>,
        );
        let old: PreRateContribution = (
            48_000,
            480,
            0.0,
            vec![0.0, 0.01],
            vec![Some(1.0), None],
            1.0,
            1.0,
            true,
            94.0,
            Some(Contribution {
                frames: 2,
                bins: 1,
                times: vec![0.0, 0.01],
                bands: vec![1_000.0],
                values: vec![0.5, 0.0],
                label: "band modulation".to_string(),
                unit: Some("asper".to_string()),
            }),
        );
        let bytes = postcard::to_stdvec(&old).expect("encode pre-rate-contribution");
        let stored: StoredCalibratedSeries =
            postcard::from_bytes(&bytes).expect("decode pre-rate-contribution");
        let series = CalibratedSeriesResult::from(stored);
        assert!(series.rate_contribution.is_none());
        assert!(series.contribution.is_some());
        assert_eq!(series.values, vec![Some(1.0), None]);
    }
}
