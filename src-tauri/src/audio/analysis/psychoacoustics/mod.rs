//! Shared psychoacoustic building blocks (M26).
//!
//! [`scales`] holds the Bark and ERB conversions (both directions) and
//! [`bands`] turns the shared STFT magnitude into per-critical-band energy.
//! [`loudness`] is the Moore–Glasberg stationary loudness model built on both.
//! [`modulation`] is the band-envelope → modulation-filter pipeline that
//! `roughness` and `fluctuationStrength` share (M29).

pub mod bands;
pub mod loudness;
pub mod modulation;
pub mod scales;

pub use scales::Scale;
