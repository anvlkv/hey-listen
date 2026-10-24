//! Analysis tool implementations, grouped by family (see `docs/analysis-tools.md`),
//! plus the [`run`] dispatcher that maps a tool id to its implementation.

mod dispatch;
mod features;
mod spectrum;
mod time;

pub use dispatch::run;
pub use features::{chromagram, mel_spectrogram, mfcc, spectral_contrast};
pub use spectrum::{spectrogram, spectrum};
pub use time::{frame_rms_envelope, levels, waveform};
