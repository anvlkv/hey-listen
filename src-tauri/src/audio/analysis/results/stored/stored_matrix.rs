//! The postcard-safe stored form of a [`MatrixResult`] (X3).
//!
//! See [`super::stored`] for the positional-wrapper rationale. The four trailing
//! fields (`bandEdges`, `unit`, `calibrated`, `calibrationDbSpl`) are the X3 metadata,
//! and `model` / `normalized` are the M36 band-axis metadata; they are appended after
//! the original eleven so a file written before they existed still decodes: `postcard`
//! is positional, so the reader takes each trailing field as its default when the
//! buffer ends early (a pre-X3/pre-M36 file, never a corrupt value — the file's
//! checksum rules that out).

use serde::{Deserialize, Serialize};

use super::decode::Fields;
use crate::audio::analysis::MatrixResult;

/// The postcard-safe stored fields of a [`MatrixResult`].
#[derive(Clone, Serialize)]
pub struct StoredMatrix {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    pub bins: usize,
    pub duration: f32,
    pub times: Vec<f32>,
    pub window_start: f64,
    pub bands: Vec<f32>,
    pub values: Vec<f32>,
    pub min_value: f32,
    pub max_value: f32,
    pub band_edges: Option<Vec<f32>>,
    pub unit: Option<String>,
    pub calibrated: bool,
    pub calibration_db_spl: f32,
    pub model: Option<String>,
    pub normalized: Option<bool>,
}

impl<'de> Deserialize<'de> for StoredMatrix {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct MatrixVisitor;
        impl<'de> serde::de::Visitor<'de> for MatrixVisitor {
            type Value = StoredMatrix;

            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("a matrix result")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut f: Fields<'_, 'de, A> = Fields::new(&mut seq, "a matrix result");
                Ok(StoredMatrix {
                    sample_rate: f.req()?,
                    hop_size: f.req()?,
                    frames: f.req()?,
                    bins: f.req()?,
                    duration: f.req()?,
                    times: f.req()?,
                    window_start: f.req()?,
                    bands: f.req()?,
                    values: f.req()?,
                    min_value: f.req()?,
                    max_value: f.req()?,
                    // The X3 metadata: a pre-X3 file ends before it.
                    band_edges: f.opt(),
                    unit: f.opt(),
                    calibrated: f.defaulted(),
                    calibration_db_spl: f.defaulted(),
                    // The M36 band-axis metadata: a pre-M36 file ends before it.
                    model: f.opt(),
                    normalized: f.opt(),
                })
            }
        }
        deserializer.deserialize_tuple(17, MatrixVisitor)
    }
}

impl std::fmt::Debug for StoredMatrix {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        MatrixResult::from(self.clone()).fmt(f)
    }
}

impl From<&MatrixResult> for StoredMatrix {
    fn from(r: &MatrixResult) -> Self {
        Self {
            sample_rate: r.sample_rate,
            hop_size: r.hop_size,
            frames: r.frames,
            bins: r.bins,
            duration: r.duration,
            times: r.times.clone(),
            window_start: r.window_start,
            bands: r.bands.clone(),
            values: r.values.clone(),
            min_value: r.min_value,
            max_value: r.max_value,
            band_edges: r.band_edges.clone(),
            unit: r.unit.clone(),
            calibrated: r.calibrated,
            calibration_db_spl: r.calibration_db_spl,
            model: r.model.clone(),
            normalized: r.normalized,
        }
    }
}

impl From<StoredMatrix> for MatrixResult {
    fn from(stored: StoredMatrix) -> Self {
        Self {
            sample_rate: stored.sample_rate,
            hop_size: stored.hop_size,
            frames: stored.frames,
            bins: stored.bins,
            duration: stored.duration,
            times: stored.times,
            window_start: stored.window_start,
            bands: stored.bands,
            values: stored.values,
            min_value: stored.min_value,
            max_value: stored.max_value,
            band_edges: stored.band_edges,
            unit: stored.unit,
            calibrated: stored.calibrated,
            calibration_db_spl: stored.calibration_db_spl,
            model: stored.model,
            normalized: stored.normalized,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::StoredMatrix;
    use crate::audio::analysis::fixtures;
    use crate::audio::analysis::MatrixResult;

    #[test]
    fn a_matrix_with_x3_metadata_round_trips_through_postcard() {
        let matrix = MatrixResult {
            unit: Some("sone/Cam".to_string()),
            band_edges: Some(vec![0.0, 1.0, 2.0]),
            calibrated: true,
            calibration_db_spl: 94.0,
            ..fixtures::matrix()
        };
        let bytes = postcard::to_stdvec(&StoredMatrix::from(&matrix)).expect("encode");
        let decoded = postcard::from_bytes::<StoredMatrix>(&bytes).expect("decode");
        let round = MatrixResult::from(decoded);
        assert_eq!(
            serde_json::to_value(&round).expect("json"),
            serde_json::to_value(&matrix).expect("json"),
        );
    }

    #[test]
    fn a_pre_x3_matrix_decodes_with_defaults() {
        // The stored form before X3 was the original eleven fields; `postcard` is
        // positional, so a plain tuple reproduces those bytes exactly. The reader
        // then defaults the four trailing X3 fields instead of failing the load.
        type PreX3 = (
            u32,
            usize,
            usize,
            usize,
            f32,
            Vec<f32>,
            f64,
            Vec<f32>,
            Vec<f32>,
            f32,
            f32,
        );
        let old: PreX3 = (
            48_000,
            480,
            2,
            2,
            0.02,
            vec![0.0, 0.1],
            0.0,
            vec![0.0, 1.0],
            vec![1.0, 2.0, 3.0, 4.0],
            1.0,
            4.0,
        );
        let bytes = postcard::to_stdvec(&old).expect("encode pre-X3");
        let stored: StoredMatrix = postcard::from_bytes(&bytes).expect("decode pre-X3");
        let matrix = MatrixResult::from(stored);
        assert_eq!(matrix.unit, None);
        assert_eq!(matrix.band_edges, None);
        assert!(!matrix.calibrated);
        assert_eq!(matrix.calibration_db_spl, 0.0);
        assert_eq!(matrix.values, vec![1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn a_pre_model_matrix_decodes_with_defaults() {
        // The stored form before M36 was the fifteen X3 fields; `postcard` is
        // positional, so a plain tuple reproduces those bytes exactly. The reader then
        // defaults `model` and `normalized` instead of failing the load.
        type PreModel = (
            u32,
            usize,
            usize,
            usize,
            f32,
            Vec<f32>,
            f64,
            Vec<f32>,
            Vec<f32>,
            f32,
            f32,
            Option<Vec<f32>>,
            Option<String>,
            bool,
            f32,
        );
        let old: PreModel = (
            48_000,
            480,
            2,
            2,
            0.02,
            vec![0.0, 0.1],
            0.0,
            vec![0.0, 1.0],
            vec![1.0, 2.0, 3.0, 4.0],
            1.0,
            4.0,
            Some(vec![0.0, 150.0, 500.0]),
            Some("dB".to_string()),
            true,
            94.0,
        );
        let bytes = postcard::to_stdvec(&old).expect("encode pre-model");
        let stored: StoredMatrix = postcard::from_bytes(&bytes).expect("decode pre-model");
        let matrix = MatrixResult::from(stored);
        assert_eq!(matrix.model, None);
        assert_eq!(matrix.normalized, None);
        assert_eq!(matrix.unit.as_deref(), Some("dB"));
        assert_eq!(matrix.values, vec![1.0, 2.0, 3.0, 4.0]);
    }
}
