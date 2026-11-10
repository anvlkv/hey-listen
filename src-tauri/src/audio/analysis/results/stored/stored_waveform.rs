//! The postcard-safe stored form of a [`WaveformResult`] (M36).
//!
//! See [`super::stored`] for the positional-wrapper rationale. The trailing
//! `bucket_rms` / `clipped_buckets` fields are appended after the original ten, so a
//! file written before they existed still decodes: `postcard` is positional, so the
//! reader defaults the trailing fields when the buffer ends early (a pre-M36 file,
//! never a corrupt value — the file's checksum rules that out).

use serde::{Deserialize, Serialize};

use super::decode::Fields;
use crate::audio::analysis::WaveformResult;

/// The postcard-safe stored fields of a [`WaveformResult`].
#[derive(Clone, Serialize)]
pub struct StoredWaveform {
    pub sample_rate: u32,
    pub frames: usize,
    pub duration: f64,
    pub window_start: f64,
    pub peak: f32,
    pub rms: f32,
    pub peak_db: f32,
    pub rms_db: f32,
    pub min: Vec<f32>,
    pub max: Vec<f32>,
    pub bucket_rms: Vec<f32>,
    pub clipped_buckets: usize,
}

impl<'de> Deserialize<'de> for StoredWaveform {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct WaveformVisitor;
        impl<'de> serde::de::Visitor<'de> for WaveformVisitor {
            type Value = StoredWaveform;

            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("a waveform result")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut f: Fields<'_, 'de, A> = Fields::new(&mut seq, "a waveform result");
                Ok(StoredWaveform {
                    sample_rate: f.req()?,
                    frames: f.req()?,
                    duration: f.req()?,
                    window_start: f.req()?,
                    peak: f.req()?,
                    rms: f.req()?,
                    peak_db: f.req()?,
                    rms_db: f.req()?,
                    min: f.req()?,
                    max: f.req()?,
                    // The per-bucket level data: a pre-M36 file ends before them.
                    bucket_rms: f.defaulted(),
                    clipped_buckets: f.defaulted(),
                })
            }
        }
        deserializer.deserialize_tuple(12, WaveformVisitor)
    }
}

impl std::fmt::Debug for StoredWaveform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        WaveformResult::from(self.clone()).fmt(f)
    }
}

impl From<&WaveformResult> for StoredWaveform {
    fn from(r: &WaveformResult) -> Self {
        Self {
            sample_rate: r.sample_rate,
            frames: r.frames,
            duration: r.duration,
            window_start: r.window_start,
            peak: r.peak,
            rms: r.rms,
            peak_db: r.peak_db,
            rms_db: r.rms_db,
            min: r.min.clone(),
            max: r.max.clone(),
            bucket_rms: r.bucket_rms.clone(),
            clipped_buckets: r.clipped_buckets,
        }
    }
}

impl From<StoredWaveform> for WaveformResult {
    fn from(stored: StoredWaveform) -> Self {
        Self {
            sample_rate: stored.sample_rate,
            frames: stored.frames,
            duration: stored.duration,
            window_start: stored.window_start,
            peak: stored.peak,
            rms: stored.rms,
            peak_db: stored.peak_db,
            rms_db: stored.rms_db,
            min: stored.min,
            max: stored.max,
            bucket_rms: stored.bucket_rms,
            clipped_buckets: stored.clipped_buckets,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::StoredWaveform;
    use crate::audio::analysis::WaveformResult;

    #[test]
    fn a_waveform_with_bucket_levels_round_trips_through_postcard() {
        let waveform = WaveformResult {
            sample_rate: 48_000,
            frames: 4,
            duration: 0.000083,
            window_start: 0.0,
            peak: 2.0,
            rms: 1.5,
            peak_db: 6.02,
            rms_db: 3.52,
            min: vec![-2.0, -1.0],
            max: vec![2.0, 1.0],
            bucket_rms: vec![1.8, 0.7],
            clipped_buckets: 2,
        };
        let bytes = postcard::to_stdvec(&StoredWaveform::from(&waveform)).expect("encode");
        let decoded = postcard::from_bytes::<StoredWaveform>(&bytes).expect("decode");
        let round = WaveformResult::from(decoded);
        assert_eq!(
            serde_json::to_value(&round).expect("json"),
            serde_json::to_value(&waveform).expect("json"),
        );
    }

    #[test]
    fn a_pre_bucket_levels_waveform_decodes_with_defaults() {
        // The stored form before M36 was the original ten fields; `postcard` is
        // positional, so a plain tuple reproduces those bytes exactly. The reader then
        // defaults `bucket_rms` and `clipped_buckets` instead of failing the load.
        type PreBucketLevels = (u32, usize, f64, f64, f32, f32, f32, f32, Vec<f32>, Vec<f32>);
        let old: PreBucketLevels = (
            48_000,
            48_000,
            1.0,
            0.0,
            0.5,
            0.35,
            -6.0,
            -9.0,
            vec![-0.5, -0.4],
            vec![0.5, 0.4],
        );
        let bytes = postcard::to_stdvec(&old).expect("encode pre-bucket-levels");
        let stored: StoredWaveform =
            postcard::from_bytes(&bytes).expect("decode pre-bucket-levels");
        let waveform = WaveformResult::from(stored);
        assert!(waveform.bucket_rms.is_empty());
        assert_eq!(waveform.clipped_buckets, 0);
        assert_eq!(waveform.max, vec![0.5, 0.4]);
    }
}
