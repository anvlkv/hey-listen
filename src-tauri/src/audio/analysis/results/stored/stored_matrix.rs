//! The postcard-safe stored form of a [`MatrixResult`] (X3).
//!
//! See [`super::stored`] for the positional-wrapper rationale. The four trailing
//! fields (`bandEdges`, `unit`, `calibrated`, `calibrationDbSpl`) are the X3 metadata,
//! appended after the original eleven so a file written before they existed still
//! decodes: `postcard` is positional, so the reader takes each trailing field as its
//! default when the buffer ends early (a pre-X3 file, never a corrupt value — the
//! file's checksum rules that out).

use serde::{Deserialize, Serialize};

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
                use serde::de::Error as _;
                let sample_rate = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(0, &self))?;
                let hop_size = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(1, &self))?;
                let frames = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(2, &self))?;
                let bins = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(3, &self))?;
                let duration = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(4, &self))?;
                let times = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(5, &self))?;
                let window_start = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(6, &self))?;
                let bands = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(7, &self))?;
                let values = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(8, &self))?;
                let min_value = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(9, &self))?;
                let max_value = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(10, &self))?;
                // The X3 metadata: default when the buffer ends (a pre-X3 file).
                let band_edges: Option<Vec<f32>> = trailing_opt(&mut seq);
                let unit: Option<String> = trailing_opt(&mut seq);
                let calibrated: bool = trailing_val(&mut seq);
                let calibration_db_spl: f32 = trailing_val(&mut seq);
                Ok(StoredMatrix {
                    sample_rate,
                    hop_size,
                    frames,
                    bins,
                    duration,
                    times,
                    window_start,
                    bands,
                    values,
                    min_value,
                    max_value,
                    band_edges,
                    unit,
                    calibrated,
                    calibration_db_spl,
                })
            }
        }
        deserializer.deserialize_tuple(15, MatrixVisitor)
    }
}

/// Read an optional trailing field, defaulting to `None` when the buffer ends early.
fn trailing_opt<'de, A: serde::de::SeqAccess<'de>, T: Deserialize<'de>>(seq: &mut A) -> Option<T> {
    match seq.next_element::<Option<T>>() {
        Ok(Some(value)) => value,
        _ => None,
    }
}

/// Read a trailing field, defaulting to `T::default()` when the buffer ends early.
fn trailing_val<'de, A: serde::de::SeqAccess<'de>, T: Deserialize<'de> + Default>(
    seq: &mut A,
) -> T {
    match seq.next_element::<T>() {
        Ok(Some(value)) => value,
        _ => T::default(),
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
}
