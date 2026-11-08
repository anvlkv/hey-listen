//! Shared psychoacoustic building blocks (M26).
//!
//! [`scales`] holds the Bark and ERB conversions (both directions) and
//! [`bands`] turns the shared STFT magnitude into per-critical-band energy.
//! Later milestones (loudness, sharpness, masking) build on the same two.

pub mod bands;
pub mod scales;

pub use scales::Scale;
