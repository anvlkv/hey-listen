//! Shared psychoacoustic building blocks (M26).
//!
//! [`scales`] holds the Bark and ERB conversions (both directions), [`bands`] turns the
//! shared STFT magnitude into per-critical-band energy, and [`threshold`] is the
//! threshold in quiet. [`loudness`] is the Moore–Glasberg stationary loudness model
//! built on the first two, [`modulation`] is the band-envelope → modulation-filter
//! pipeline that `roughness` and `fluctuationStrength` share (M29), [`masking`]
//! detects tonal/non-tonal maskers and builds the global masking threshold (M30),
//! and [`mid_side`] holds the stereo mid/side and inter-channel correlation cues
//! (M31).

pub mod bands;
pub mod loudness;
pub mod masking;
pub mod mid_side;
pub mod modulation;
pub mod scales;
pub mod threshold;

pub use scales::Scale;
