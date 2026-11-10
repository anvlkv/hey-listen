//! The postcard-safe stored form of a [`PitchResult`] (M36).
//!
//! See [`super::stored`] for the positional-wrapper rationale. The trailing
//! `confidence` field is appended after the original thirteen, so a file written before
//! it existed still decodes: `postcard` is positional, so the reader defaults the
//! trailing field when the buffer ends early (a pre-M36 file, never a corrupt value —
//! the file's checksum rules that out).

use serde::{Deserialize, Serialize};

use super::decode::Fields;
use crate::audio::analysis::PitchResult;

/// The postcard-safe stored fields of a [`PitchResult`].
#[derive(Clone, Serialize)]
pub struct StoredPitch {
    pub sample_rate: u32,
    pub hop_size: usize,
    pub frames: usize,
    pub times: Vec<f32>,
    pub window_start: f64,
    pub values: Vec<Option<f32>>,
    pub min_value: f32,
    pub max_value: f32,
    pub effective_min_f0_hz: f32,
    pub effective_max_f0_hz: f32,
    pub voiced_frames: usize,
    pub voiced_fraction: f32,
    pub f0_reliable: bool,
    pub confidence: Vec<Option<f32>>,
}

impl<'de> Deserialize<'de> for StoredPitch {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct PitchVisitor;
        impl<'de> serde::de::Visitor<'de> for PitchVisitor {
            type Value = StoredPitch;

            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("a pitch result")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut f: Fields<'_, 'de, A> = Fields::new(&mut seq, "a pitch result");
                Ok(StoredPitch {
                    sample_rate: f.req()?,
                    hop_size: f.req()?,
                    frames: f.req()?,
                    times: f.req()?,
                    window_start: f.req()?,
                    values: f.req()?,
                    min_value: f.req()?,
                    max_value: f.req()?,
                    effective_min_f0_hz: f.req()?,
                    effective_max_f0_hz: f.req()?,
                    voiced_frames: f.req()?,
                    voiced_fraction: f.req()?,
                    f0_reliable: f.req()?,
                    // The per-frame confidence: a pre-M36 file ends before it.
                    confidence: f.defaulted(),
                })
            }
        }
        deserializer.deserialize_tuple(14, PitchVisitor)
    }
}

impl std::fmt::Debug for StoredPitch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        PitchResult::from(self.clone()).fmt(f)
    }
}

impl From<&PitchResult> for StoredPitch {
    fn from(r: &PitchResult) -> Self {
        Self {
            sample_rate: r.sample_rate,
            hop_size: r.hop_size,
            frames: r.frames,
            times: r.times.clone(),
            window_start: r.window_start,
            values: r.values.clone(),
            min_value: r.min_value,
            max_value: r.max_value,
            effective_min_f0_hz: r.effective_min_f0_hz,
            effective_max_f0_hz: r.effective_max_f0_hz,
            voiced_frames: r.voiced_frames,
            voiced_fraction: r.voiced_fraction,
            f0_reliable: r.f0_reliable,
            confidence: r.confidence.clone(),
        }
    }
}

impl From<StoredPitch> for PitchResult {
    fn from(stored: StoredPitch) -> Self {
        Self {
            sample_rate: stored.sample_rate,
            hop_size: stored.hop_size,
            frames: stored.frames,
            times: stored.times,
            window_start: stored.window_start,
            values: stored.values,
            min_value: stored.min_value,
            max_value: stored.max_value,
            effective_min_f0_hz: stored.effective_min_f0_hz,
            effective_max_f0_hz: stored.effective_max_f0_hz,
            voiced_frames: stored.voiced_frames,
            voiced_fraction: stored.voiced_fraction,
            f0_reliable: stored.f0_reliable,
            confidence: stored.confidence,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::StoredPitch;
    use crate::audio::analysis::{fixtures, PitchResult};

    #[test]
    fn a_pitch_with_confidence_round_trips_through_postcard() {
        let pitch = PitchResult {
            confidence: vec![Some(0.9), None, Some(0.8), Some(0.7)],
            ..fixtures::pitch()
        };
        let bytes = postcard::to_stdvec(&StoredPitch::from(&pitch)).expect("encode");
        let decoded = postcard::from_bytes::<StoredPitch>(&bytes).expect("decode");
        let round = PitchResult::from(decoded);
        assert_eq!(
            serde_json::to_value(&round).expect("json"),
            serde_json::to_value(&pitch).expect("json"),
        );
    }

    #[test]
    fn a_pre_confidence_pitch_decodes_with_defaults() {
        // The stored form before M36 was the original thirteen fields; `postcard` is
        // positional, so a plain tuple reproduces those bytes exactly. The reader then
        // defaults the trailing `confidence` instead of failing the load.
        type PreConfidence = (
            u32,
            usize,
            usize,
            Vec<f32>,
            f64,
            Vec<Option<f32>>,
            f32,
            f32,
            f32,
            f32,
            usize,
            f32,
            bool,
        );
        let old: PreConfidence = (
            48_000,
            480,
            2,
            vec![0.0, 0.01],
            0.0,
            vec![Some(220.0), None],
            220.0,
            220.0,
            50.0,
            2_000.0,
            1,
            0.5,
            false,
        );
        let bytes = postcard::to_stdvec(&old).expect("encode pre-confidence");
        let stored: StoredPitch = postcard::from_bytes(&bytes).expect("decode pre-confidence");
        let pitch = PitchResult::from(stored);
        assert!(pitch.confidence.is_empty());
        assert_eq!(pitch.values, vec![Some(220.0), None]);
        assert_eq!(pitch.effective_min_f0_hz, 50.0);
    }
}
