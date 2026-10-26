//! Analysis tool implementations, grouped by family (see `docs/analysis-tools.md`),
//! plus the [`run`] dispatcher that maps a tool id to its implementation.

mod dispatch;
mod features;
mod gate;
mod modulation;
mod modulation_dsp;
mod note_quality;
mod notes;
mod pitch_track;
mod spectrum;
mod time;

pub use dispatch::run;
pub use features::{chromagram, mel_spectrogram, mfcc, spectral_contrast};
pub use modulation::modulation;
pub use notes::note_metrics;
pub use spectrum::{spectrogram, spectrum};
pub use time::{frame_rms_envelope, levels, waveform};
