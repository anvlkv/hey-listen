//! The postcard-safe stored form of a [`LoudnessResult`] (M36).
//!
//! See [`super::stored`] for the positional-wrapper rationale. The trailing `model` /
//! `standard` fields are appended after the original eight, so a file written before
//! they existed still decodes: `postcard` is positional, so the reader defaults the
//! trailing fields when the buffer ends early (a pre-M36 file, never a corrupt value —
//! the file's checksum rules that out).

use serde::{Deserialize, Serialize};

use super::decode::Fields;
use crate::audio::analysis::LoudnessResult;

/// The postcard-safe stored fields of a [`LoudnessResult`].
#[derive(Clone, Serialize)]
pub struct StoredLoudness {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub window_start: f64,
    pub times: Vec<f32>,
    pub loudness_sone: Vec<Option<f32>>,
    pub loudness_phon: Vec<Option<f32>>,
    pub calibrated: bool,
    pub calibration_db_spl: f32,
    pub model: Option<String>,
    pub standard: Option<String>,
}

impl<'de> Deserialize<'de> for StoredLoudness {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct LoudnessVisitor;
        impl<'de> serde::de::Visitor<'de> for LoudnessVisitor {
            type Value = StoredLoudness;

            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("a loudness result")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut f: Fields<'_, 'de, A> = Fields::new(&mut seq, "a loudness result");
                Ok(StoredLoudness {
                    sample_rate: f.req()?,
                    hop_size: f.req()?,
                    window_start: f.req()?,
                    times: f.req()?,
                    loudness_sone: f.req()?,
                    loudness_phon: f.req()?,
                    calibrated: f.req()?,
                    calibration_db_spl: f.req()?,
                    // The model / standard metadata: a pre-M36 file ends before them.
                    model: f.opt(),
                    standard: f.opt(),
                })
            }
        }
        deserializer.deserialize_tuple(10, LoudnessVisitor)
    }
}

impl std::fmt::Debug for StoredLoudness {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        LoudnessResult::from(self.clone()).fmt(f)
    }
}

impl From<&LoudnessResult> for StoredLoudness {
    fn from(r: &LoudnessResult) -> Self {
        Self {
            sample_rate: r.sample_rate,
            hop_size: r.hop_size,
            window_start: r.window_start,
            times: r.times.clone(),
            loudness_sone: r.loudness_sone.clone(),
            loudness_phon: r.loudness_phon.clone(),
            calibrated: r.calibrated,
            calibration_db_spl: r.calibration_db_spl,
            model: r.model.clone(),
            standard: r.standard.clone(),
        }
    }
}

impl From<StoredLoudness> for LoudnessResult {
    fn from(stored: StoredLoudness) -> Self {
        Self {
            sample_rate: stored.sample_rate,
            hop_size: stored.hop_size,
            window_start: stored.window_start,
            times: stored.times,
            loudness_sone: stored.loudness_sone,
            loudness_phon: stored.loudness_phon,
            calibrated: stored.calibrated,
            calibration_db_spl: stored.calibration_db_spl,
            model: stored.model,
            standard: stored.standard,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::StoredLoudness;
    use crate::audio::analysis::{fixtures, LoudnessResult};

    #[test]
    fn a_loudness_with_model_metadata_round_trips_through_postcard() {
        let loudness = fixtures::loudness();
        let bytes = postcard::to_stdvec(&StoredLoudness::from(&loudness)).expect("encode");
        let decoded = postcard::from_bytes::<StoredLoudness>(&bytes).expect("decode");
        let round = LoudnessResult::from(decoded);
        assert_eq!(
            serde_json::to_value(&round).expect("json"),
            serde_json::to_value(&loudness).expect("json"),
        );
    }

    #[test]
    fn a_pre_model_loudness_decodes_with_defaults() {
        // The stored form before M36 was the original eight fields; `postcard` is
        // positional, so a plain tuple reproduces those bytes exactly. The reader then
        // defaults `model` and `standard` instead of failing the load.
        type PreModel = (
            u32,
            usize,
            f64,
            Vec<f32>,
            Vec<Option<f32>>,
            Vec<Option<f32>>,
            bool,
            f32,
        );
        let old: PreModel = (
            48_000,
            480,
            0.0,
            vec![0.0, 0.01],
            vec![Some(1.0), None],
            vec![Some(40.0), None],
            true,
            94.0,
        );
        let bytes = postcard::to_stdvec(&old).expect("encode pre-model");
        let stored: StoredLoudness = postcard::from_bytes(&bytes).expect("decode pre-model");
        let loudness = LoudnessResult::from(stored);
        assert_eq!(loudness.model, None);
        assert_eq!(loudness.standard, None);
        assert_eq!(loudness.loudness_sone, vec![Some(1.0), None]);
        assert!(loudness.calibrated);
    }
}
