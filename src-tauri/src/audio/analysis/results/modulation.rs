//! The AM/FM modulation-spectrum result types (M20), split out of [`super`] to keep
//! each file inside the source-size budget.

use serde::Serialize;

/// One ranked peak in a modulation spectrum (M20).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModulationPeak {
    /// The peak's modulation rate, in Hz.
    pub rate_hz: f32,
    /// The peak's level relative to the spectrum's strongest bin (0 dB = strongest).
    pub relative_db: f32,
    /// How far the peak stands above its surrounding valley, in dB.
    pub prominence_db: f32,
}

/// AM/FM modulation spectra over the window (M20): the amplitude-envelope spectrum,
/// the pitch-residual (cents) spectrum of the longest voiced run, their ranked peaks,
/// and the depth readouts. Both spectra share `mod_freqs`; `fm_db` is empty when no
/// voiced run is long enough to analyse.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModulationResult {
    /// Source seconds where the window starts.
    pub window_start: f64,
    /// The modulation-rate range actually analysed, after the anti-alias clamp.
    pub effective_mod_min_hz: f32,
    pub effective_mod_max_hz: f32,
    /// Shared rate axis (Hz), one entry per bin in `am_db` / `fm_db`.
    pub mod_freqs: Vec<f32>,
    /// Amplitude-modulation spectrum, relative dB (0 = strongest bin). Empty when the
    /// envelope is effectively steady (under 2% depth), so a flat spectrum is not drawn.
    pub am_db: Vec<f32>,
    /// Pitch-modulation (cents) spectrum, relative dB. Empty without a voiced run, or
    /// when that run's pitch is effectively steady (under 2 cents of spread).
    pub fm_db: Vec<f32>,
    /// The strongest `topPeaks` rates, strongest first (empty with their spectrum).
    pub am_peaks: Vec<ModulationPeak>,
    pub fm_peaks: Vec<ModulationPeak>,
    /// `(max − min) / (max + min)` of the linear amplitude envelope (0…1).
    pub am_depth: Option<f32>,
    /// Peak-to-trough range of the frame-RMS envelope, in dB.
    pub am_peak_to_trough_db: Option<f32>,
    /// The analysed FM run's source-second span (absent when none was long enough).
    pub fm_run_start_secs: Option<f32>,
    pub fm_run_end_secs: Option<f32>,
    /// The strongest FM rate (the first entry in `fm_peaks`).
    pub fm_rate_hz: Option<f32>,
    /// Peak-to-peak and standard-deviation depth of the detrended cents track.
    pub fm_peak_to_peak_cents: Option<f32>,
    pub fm_std_cents: Option<f32>,
    /// Share of the window's pitch frames the detector found voiced (0…1).
    pub voiced_fraction: f32,
}
