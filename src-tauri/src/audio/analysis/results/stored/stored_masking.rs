//! The postcard-safe stored form of a [`MaskingResult`] (M36).
//!
//! See [`super::stored`] for the positional-wrapper rationale. The trailing `maskers`
//! list is appended after the original eleven fields, so a file written before it
//! existed still decodes: `postcard` is positional, so the reader defaults the trailing
//! field when the buffer ends early (a pre-M36 file, never a corrupt value — the file's
//! checksum rules that out).

use serde::{Deserialize, Serialize};

use super::decode::Fields;
use crate::audio::analysis::{MaskerInfo, MaskingResult};

/// The postcard-safe stored fields of a [`MaskingResult`].
#[derive(Clone, Serialize)]
pub struct StoredMasking {
    pub sample_rate: u32,
    pub fft_size: usize,
    pub frames: usize,
    pub window_start: f64,
    pub freqs: Vec<f32>,
    pub spectrum_db: Vec<f32>,
    pub threshold_quiet_db: Vec<f32>,
    pub global_mask_db: Vec<f32>,
    pub smr_db: Vec<f32>,
    pub calibrated: bool,
    pub calibration_db_spl: f32,
    pub maskers: Vec<MaskerInfo>,
}

impl<'de> Deserialize<'de> for StoredMasking {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct MaskingVisitor;
        impl<'de> serde::de::Visitor<'de> for MaskingVisitor {
            type Value = StoredMasking;

            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("a masking result")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut f: Fields<'_, 'de, A> = Fields::new(&mut seq, "a masking result");
                Ok(StoredMasking {
                    sample_rate: f.req()?,
                    fft_size: f.req()?,
                    frames: f.req()?,
                    window_start: f.req()?,
                    freqs: f.req()?,
                    spectrum_db: f.req()?,
                    threshold_quiet_db: f.req()?,
                    global_mask_db: f.req()?,
                    smr_db: f.req()?,
                    calibrated: f.req()?,
                    calibration_db_spl: f.req()?,
                    // The M36 masker list: a file written before it ends here.
                    maskers: f.defaulted(),
                })
            }
        }
        deserializer.deserialize_tuple(12, MaskingVisitor)
    }
}

impl std::fmt::Debug for StoredMasking {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        MaskingResult::from(self.clone()).fmt(f)
    }
}

impl From<&MaskingResult> for StoredMasking {
    fn from(r: &MaskingResult) -> Self {
        Self {
            sample_rate: r.sample_rate,
            fft_size: r.fft_size,
            frames: r.frames,
            window_start: r.window_start,
            freqs: r.freqs.clone(),
            spectrum_db: r.spectrum_db.clone(),
            threshold_quiet_db: r.threshold_quiet_db.clone(),
            global_mask_db: r.global_mask_db.clone(),
            smr_db: r.smr_db.clone(),
            calibrated: r.calibrated,
            calibration_db_spl: r.calibration_db_spl,
            maskers: r.maskers.clone(),
        }
    }
}

impl From<StoredMasking> for MaskingResult {
    fn from(stored: StoredMasking) -> Self {
        Self {
            sample_rate: stored.sample_rate,
            fft_size: stored.fft_size,
            frames: stored.frames,
            window_start: stored.window_start,
            freqs: stored.freqs,
            spectrum_db: stored.spectrum_db,
            threshold_quiet_db: stored.threshold_quiet_db,
            global_mask_db: stored.global_mask_db,
            smr_db: stored.smr_db,
            calibrated: stored.calibrated,
            calibration_db_spl: stored.calibration_db_spl,
            maskers: stored.maskers,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::StoredMasking;
    use crate::audio::analysis::{fixtures, MaskingResult};

    #[test]
    fn a_masking_with_maskers_round_trips_through_postcard() {
        let masking = fixtures::masking();
        let bytes = postcard::to_stdvec(&StoredMasking::from(&masking)).expect("encode");
        let decoded = postcard::from_bytes::<StoredMasking>(&bytes).expect("decode");
        let round = MaskingResult::from(decoded);
        assert_eq!(
            serde_json::to_value(&round).expect("json"),
            serde_json::to_value(&masking).expect("json"),
        );
    }

    #[test]
    fn a_pre_maskers_masking_decodes_with_defaults() {
        // The stored form before M36 was the original eleven fields; `postcard` is
        // positional, so a plain tuple reproduces those bytes exactly. The reader then
        // defaults `maskers` instead of failing the load.
        type PreMaskers = (
            u32,
            usize,
            usize,
            f64,
            Vec<f32>,
            Vec<f32>,
            Vec<f32>,
            Vec<f32>,
            Vec<f32>,
            bool,
            f32,
        );
        let old: PreMaskers = (
            48_000,
            2_048,
            10,
            0.0,
            vec![100.0, 200.0],
            vec![-30.0, -6.0],
            vec![40.0, 20.0],
            vec![45.0, 30.0],
            vec![-75.0, -36.0],
            true,
            94.0,
        );
        let bytes = postcard::to_stdvec(&old).expect("encode pre-maskers");
        let stored: StoredMasking = postcard::from_bytes(&bytes).expect("decode pre-maskers");
        let masking = MaskingResult::from(stored);
        assert!(masking.maskers.is_empty());
        assert_eq!(masking.freqs, vec![100.0, 200.0]);
        assert!(masking.calibrated);
    }
}
