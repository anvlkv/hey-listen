//! AM/FM modulation spectra (M20), plus the optional per-note breakdown (D-18).
//!
//! The measurement itself lives in `modulation_core` so a detected note
//! segment and the whole window run the **same** spectra / depth / peak code. This
//! module only decides what to measure: the window, and — when `perNote` is on — each
//! note the M18 segmenter finds.

use super::super::support::frame_rms;
use super::super::{AnalysisError, Cancel, ModulationResult, ToolOptions};
use super::modulation_core::measure;
use super::modulation_notes::per_note;

/// AM/FM modulation over the window (M20).
///
/// With `perNote` set, the frame-RMS envelope is also segmented into notes (the M18
/// gate) and each note is measured separately into `notes`; the window fields are
/// unchanged, so `perNote = 0` is exactly the pre-D-18 result.
pub fn modulation(
    mono: &[f32],
    sample_rate: u32,
    options: &ToolOptions,
    cancel: &Cancel,
) -> Result<ModulationResult, AnalysisError> {
    let rate = sample_rate.max(1);
    // The window envelope the per-note gate segments; the measurement core derives its
    // own grids from the same options.
    let (_times, levels, frame, hop) =
        frame_rms(mono, rate, options.frame_ms(), options.hop_ms(), cancel)?;
    let measured = measure(mono, rate, options, cancel)?;
    let notes = if options.per_note() {
        per_note(mono, rate, options, &levels, frame, hop, cancel)?
    } else {
        Vec::new()
    };

    Ok(ModulationResult {
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        effective_mod_min_hz: measured.effective_min_hz,
        effective_mod_max_hz: measured.effective_max_hz,
        mod_freqs: measured.mod_freqs,
        am_db: measured.am_db,
        fm_db: measured.fm_db,
        am_peaks: measured.am_peaks,
        fm_peaks: measured.fm_peaks,
        am_depth: measured.am_depth,
        am_peak_to_trough_db: measured.am_peak_to_trough_db,
        fm_run_start_secs: measured.fm_run_start_secs,
        fm_run_end_secs: measured.fm_run_end_secs,
        fm_rate_hz: measured.fm_rate_hz,
        fm_peak_to_peak_cents: measured.fm_peak_to_peak_cents,
        fm_std_cents: measured.fm_std_cents,
        fm_reliable: measured.fm_reliable,
        voiced_fraction: measured.voiced_fraction,
        notes,
    })
}
