//! AM/FM modulation spectra (M20): the amplitude-envelope spectrum and the
//! pitch-residual (cents) spectrum of the longest voiced run, plus their ranked
//! peaks and depth readouts.
//!
//! A single modulation rate is not enough — a call can carry slow breathing and a
//! fast trill at once — so both halves return a full spectrum over the requested
//! `modMinHz`–`modMaxHz` band. The band is clamped to ~45% of the lower of the two
//! sample rates (the envelope's frame rate and the run's pitch-frame rate) to avoid
//! aliasing, and the effective range is reported. See `docs/analysis-metrics.md` → M20.

use super::super::support::frame_rms;
use super::super::{
    ModulationResult, ToolOptions, MAX_COARSE_PITCH_FRAMES, MAX_MOD_PITCH_FRAMES,
    MIN_FM_DISTINCT_CENTS, MIN_FM_FRAMES,
};
use super::modulation_dsp::{
    cents_track, depth, detrended, linear_envelope, longest_voiced_run, peaks, rate_grid, spectrum,
    VoicedRun,
};
use super::notes::median;
use super::pitch_track::{modulated_pitch_grid, note_pitch_grid, pitch_track_with_grid};

/// The fraction of a sample rate usable before aliasing folds the spectrum back.
const ALIAS_LIMIT: f32 = 0.45;
/// Below this amplitude-modulation depth the envelope is effectively steady. Reporting
/// a normalized noise spectrum (and its argmax) would invent a rate, so both the AM
/// spectrum and its peaks stay empty; the tiny depth is still in `am_depth`.
const MIN_AM_DEPTH: f32 = 0.02;
/// Below this pitch spread (in cents) the carrier is effectively steady for the same
/// reason; the FM spectrum and its peaks stay empty while `fm_std_cents` reports it.
const MIN_FM_STD_CENTS: f32 = 2.0;

/// One analysed voiced run, ready for the shared modulation grid.
struct FmPart {
    /// The run's f0 track in cents around its median.
    cents: Vec<f32>,
    /// Cents samples per second (the fine pitch-frame rate).
    sample_rate: f32,
    start_secs: f32,
    end_secs: f32,
    peak_to_peak_cents: f32,
    std_cents: f32,
}

/// AM/FM modulation spectra over the window (M20).
pub fn modulation(mono: &[f32], sample_rate: u32, options: &ToolOptions) -> ModulationResult {
    let rate = sample_rate.max(1);
    let duration = mono.len() as f32 / rate as f32;
    let (_times, levels, _frame, hop) = frame_rms(mono, rate, options.frame_ms(), options.hop_ms());
    // The envelope is sampled once per hop; that is the AM spectrum's sample rate.
    let env_rate = rate as f32 / hop.max(1) as f32;
    let am_values = linear_envelope(&levels);

    // Coarse pitch track: only used to find the longest voiced run and the window's
    // voiced share, so it can afford a frame sized for the lowest expected f0.
    let range = options.mod_pitch_range();
    let (frame, pitch_hop) = note_pitch_grid(
        mono.len(),
        rate,
        options.pitch_frame_ms(),
        options.pitch_hop_ms(),
        range.0,
        MAX_COARSE_PITCH_FRAMES,
    );
    let coarse = pitch_track_with_grid(mono, rate, frame, pitch_hop, range);
    let coarse_hop_secs = pitch_hop as f32 / rate as f32;
    let voiced = coarse
        .iter()
        .filter(|frame| frame.is_voiced && frame.frequency_hz > 0.0)
        .count();
    let voiced_fraction = if coarse.is_empty() {
        0.0
    } else {
        voiced as f32 / coarse.len() as f32
    };
    let run = longest_voiced_run(&coarse, coarse_hop_secs, options.min_voiced_secs());
    let fm = run
        .and_then(|run| fm_part(mono, rate, run, &coarse, coarse_hop_secs, options, range))
        .filter(|part| part.cents.len() >= MIN_FM_FRAMES);
    // A short or quantized run cannot support a rate. Its spread is still reported (it
    // is a real measurement), but `fm_reliable` says the rate is not, and no spectrum
    // or peak is invented (M21.B).
    let fm_reliable = fm
        .as_ref()
        .is_some_and(|part| fm_is_reliable(part, options.min_voiced_secs()));

    // The shared band is clamped by whichever half samples more slowly, so neither
    // spectrum aliases. The result reports what was actually analysed.
    let requested = options.mod_range();
    let mut usable = ALIAS_LIMIT * env_rate;
    if let Some(part) = &fm {
        usable = usable.min(ALIAS_LIMIT * part.sample_rate);
    }
    let effective_min = requested.0.min(usable);
    let effective_max = requested.1.min(usable);

    let mut result = ModulationResult {
        // Filled in by `run_window` — the tool only sees the sliced region.
        window_start: 0.0,
        effective_mod_min_hz: effective_min,
        effective_mod_max_hz: effective_max.max(effective_min),
        mod_freqs: Vec::new(),
        am_db: Vec::new(),
        fm_db: Vec::new(),
        am_peaks: Vec::new(),
        fm_peaks: Vec::new(),
        am_depth: envelope_depth(&am_values),
        am_peak_to_trough_db: peak_to_trough(&levels),
        fm_run_start_secs: fm.as_ref().map(|part| part.start_secs),
        fm_run_end_secs: fm.as_ref().map(|part| part.end_secs),
        fm_rate_hz: None,
        fm_peak_to_peak_cents: fm.as_ref().map(|part| part.peak_to_peak_cents),
        fm_std_cents: fm.as_ref().map(|part| part.std_cents),
        fm_reliable,
        voiced_fraction,
    };

    // A sub-frame window has no modulation to resolve.
    if am_values.len() < 2 || effective_max <= effective_min {
        return result;
    }

    let freqs = rate_grid(effective_min, effective_max, duration);
    let mode = options.detrend();
    if result.am_depth.is_some_and(|depth| depth >= MIN_AM_DEPTH) {
        result.am_db = spectrum(&am_values, env_rate, mode, &freqs);
        result.am_peaks = peaks(&freqs, &result.am_db, options.top_peaks());
    }
    if let Some(part) = &fm {
        if fm_reliable && part.std_cents >= MIN_FM_STD_CENTS {
            result.fm_db = spectrum(&part.cents, part.sample_rate, mode, &freqs);
            result.fm_peaks = peaks(&freqs, &result.fm_db, options.top_peaks());
            result.fm_rate_hz = result.fm_peaks.first().map(|peak| peak.rate_hz);
        }
    }
    // Keep the shared axis only when there is a spectrum on it.
    if !(result.am_db.is_empty() && result.fm_db.is_empty()) {
        result.mod_freqs = freqs;
    }
    result
}

/// Whether the FM residual can support a rate: the run is long enough, and a track
/// with real spread visits enough distinct cents values that it is not a staircase of
/// two or three quantized levels. A steady run (under [`MIN_FM_STD_CENTS`]) is a
/// trustworthy answer too — it says there is no modulation — so it is not rejected
/// for having a single value.
fn fm_is_reliable(part: &FmPart, min_voiced_secs: f32) -> bool {
    let run_secs = part.cents.len() as f32 / part.sample_rate.max(1.0);
    if part.cents.len() < MIN_FM_FRAMES || run_secs < min_voiced_secs {
        return false;
    }
    part.std_cents < MIN_FM_STD_CENTS || distinct_cents(&part.cents) >= MIN_FM_DISTINCT_CENTS
}

/// How many distinct levels a cents track visits (a staircase has very few).
fn distinct_cents(values: &[f32]) -> usize {
    let mut sorted = values.to_vec();
    sorted.sort_by(f32::total_cmp);
    sorted.dedup_by(|a, b| *a == *b);
    sorted.len()
}

/// Track the chosen run on a modulation-friendly grid and measure its cents depth.
fn fm_part(
    mono: &[f32],
    rate: u32,
    run: VoicedRun,
    coarse: &[oxiaudio::dsp::PitchFrame],
    coarse_hop_secs: f32,
    options: &ToolOptions,
    range: (f32, f32),
) -> Option<FmPart> {
    let duration = mono.len() as f32 / rate as f32;
    let start_secs = (coarse[run.first].time_seconds as f32 - coarse_hop_secs / 2.0).max(0.0);
    let end_secs = (coarse[run.last].time_seconds as f32 + coarse_hop_secs / 2.0).min(duration);
    if end_secs <= start_secs {
        return None;
    }
    let first = ((start_secs * rate as f32).floor() as usize).min(mono.len());
    let last = ((end_secs * rate as f32).ceil() as usize)
        .min(mono.len())
        .max(first);
    let slice = &mono[first..last];

    // The run's median f0 sizes the frame: ~3 periods, capped by `pitchFrameMs`, so a
    // fast modulation is not smeared by a long analysis window.
    let voiced: Vec<f32> = coarse[run.first..=run.last]
        .iter()
        .filter(|frame| frame.is_voiced && frame.frequency_hz > 0.0)
        .map(|frame| frame.frequency_hz)
        .collect();
    let median_hz = median(&voiced).max(1.0);
    let (frame, hop) = modulated_pitch_grid(
        slice.len(),
        rate,
        options.pitch_frame_ms(),
        options.pitch_hop_ms(),
        median_hz,
        MAX_MOD_PITCH_FRAMES,
    );
    let frames = pitch_track_with_grid(slice, rate, frame, hop, range);

    // Trim unvoiced edges so the cents track starts and ends on a measured pitch.
    let first_voiced = frames
        .iter()
        .position(|frame| frame.is_voiced && frame.frequency_hz > 0.0)?;
    let last_voiced = frames
        .iter()
        .rposition(|frame| frame.is_voiced && frame.frequency_hz > 0.0)?;
    if last_voiced <= first_voiced {
        return None;
    }
    let cents = cents_track(
        &frames,
        VoicedRun {
            first: first_voiced,
            last: last_voiced,
        },
    );
    let centred = detrended(&cents, options.detrend());
    let (peak_to_peak_cents, std_cents) = depth(&centred);

    Some(FmPart {
        cents,
        sample_rate: rate as f32 / hop.max(1) as f32,
        start_secs,
        end_secs,
        peak_to_peak_cents,
        std_cents,
    })
}

/// `(max − min) / (max + min)` of the linear envelope, when it has any level.
fn envelope_depth(values: &[f32]) -> Option<f32> {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for &value in values {
        min = min.min(value);
        max = max.max(value);
    }
    if !(min.is_finite() && max.is_finite()) || max + min <= 0.0 {
        return None;
    }
    Some(((max - min) / (max + min)).clamp(0.0, 1.0))
}

/// Peak-to-trough range of the frame-RMS levels, in dB (0 for no frames).
fn peak_to_trough(levels: &[f32]) -> Option<f32> {
    if levels.is_empty() {
        return None;
    }
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for &level in levels {
        min = min.min(level);
        max = max.max(level);
    }
    Some((max - min).max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A run's cents track at `sample_rate` samples per second, with its measured depth.
    fn part(cents: Vec<f32>, sample_rate: f32) -> FmPart {
        let (peak_to_peak_cents, std_cents) = depth(&cents);
        let end_secs = cents.len() as f32 / sample_rate.max(1.0);
        FmPart {
            cents,
            sample_rate,
            start_secs: 0.0,
            end_secs,
            peak_to_peak_cents,
            std_cents,
        }
    }

    #[test]
    fn a_quantized_staircase_is_not_a_reliable_fm_rate() {
        // The Snowy Owl case: four levels over 13 frames. A spectrum fit invents a
        // 31.5 Hz vibrato; the reliability guard must reject it (M21.B).
        let pattern = [392.0f32, 415.0, 392.0, 370.0];
        let cents: Vec<f32> = (0..13).map(|index| pattern[index % 4] - 392.0).collect();
        let part = part(cents, 200.0);
        assert!(part.std_cents > MIN_FM_STD_CENTS);
        assert!(!fm_is_reliable(&part, 0.05));
    }

    #[test]
    fn a_smooth_vibrato_is_reliable() {
        let cents: Vec<f32> = (0..200)
            .map(|index| 25.0 * (index as f32 * 0.08).sin())
            .collect();
        assert!(fm_is_reliable(&part(cents, 200.0), 0.2));
    }

    #[test]
    fn a_steady_run_is_reliable_and_has_no_rate() {
        let part = part(vec![0.0; 200], 200.0);
        assert!(fm_is_reliable(&part, 0.2));
        assert!(part.std_cents < MIN_FM_STD_CENTS);
    }

    #[test]
    fn a_run_shorter_than_min_voiced_secs_is_not_reliable() {
        let cents: Vec<f32> = (0..13)
            .map(|index| 25.0 * (index as f32 * 0.5).sin())
            .collect();
        assert!(!fm_is_reliable(&part(cents, 200.0), 0.2));
    }
}
