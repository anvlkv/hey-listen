//! Analysis tool implementations, grouped by family (see `docs/analysis-tools.md`),
//! plus the [`run`] dispatcher that maps a tool id to its implementation.

mod critical_bands;
mod dispatch;
mod features;
mod fluctuation;
mod gate;
mod loudness;
mod masking;
mod modulation;
mod modulation_dsp;
mod note_quality;
mod notes;
mod pitch_track;
mod roughness;
mod shared;
mod sharpness;
pub(crate) mod spatial;
mod spectrum;
mod time;
mod tonality;

pub use dispatch::run;
pub use features::{chromagram, mel_spectrogram, mfcc, spectral_contrast};
pub use modulation::modulation;
pub use notes::note_metrics;
pub use spectrum::{spectrogram, spectrum};
pub use time::{frame_rms_envelope, levels, waveform};
