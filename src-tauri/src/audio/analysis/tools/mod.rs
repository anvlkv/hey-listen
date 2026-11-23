//! Analysis tool implementations, grouped by family,
//! plus the [`run`] dispatcher that maps a tool id to its implementation.

mod critical_bands;
mod dispatch;
mod features;
mod fluctuation;
mod gate;
mod loudness;
mod masking;
mod modulation;
mod modulation_core;
mod modulation_dsp;
mod modulation_notes;
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

pub use dispatch::run_with;
pub use features::{chromagram, mel_spectrogram, mfcc, spectral_contrast};
pub use modulation::modulation;
pub use notes::note_metrics;
pub use spectrum::{spectrogram, spectrum};
pub use time::{frame_rms_envelope, levels, waveform};

use super::{AnalysisError, AnalysisResult, Cancel, SharedParams, ToolOptions};
use crate::audio::analyzers::AnalyzerId;

/// Run a tool over conditioned mono PCM **without** cancellation.
///
/// The headless dispatcher, the CLI, exports and the tests call this; [`run_with`] is the
/// cancellable path `run_window_with` uses. Both share one dispatcher, so their results
/// cannot diverge.
pub fn run(
    tool: AnalyzerId,
    mono: &[f32],
    sample_rate: u32,
    params: &SharedParams,
    options: &ToolOptions,
) -> Result<AnalysisResult, AnalysisError> {
    run_with(tool, mono, sample_rate, params, options, &Cancel::never())
}
