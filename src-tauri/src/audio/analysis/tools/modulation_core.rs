//! The AM/FM measurement core (M20) shared by the window analysis and the optional
//! per-note breakdown (D-18): the amplitude-envelope spectrum and the pitch-residual
//! (cents) spectrum of the longest voiced run, plus their ranked peaks and depth
//! readouts. It measures **one slice**; the caller decides whether that slice is the
//! analysis window or a single detected note.
//!
//! A single rate is not enough — a call can carry slow breathing and a fast trill at
//! once — so both halves return a full spectrum over `modMinHz`–`modMaxHz`. The band is
//! clamped to ~45% of the lower analysis rate, the envelope is band-limited to that grid
//! before decimation, and the effective range is reported.

use super::super::support::frame_rms;
use super::super::{
    AnalysisError, Cancel, ModulationPeak, ToolOptions, MAX_COARSE_PITCH_FRAMES,
    MAX_MOD_PITCH_FRAMES, MIN_FM_DISTINCT_CENTS, MIN_FM_FRAMES,
};
use super::modulation_dsp::{
    band_limited_envelope, cents_track, depth, detrended, linear_envelope, longest_voiced_run,
    peaks, rate_grid, spectrum, VoicedRun,
};
use super::notes::median;
use super::pitch_track::{modulated_pitch_grid, note_pitch_grid, pitch_track_with_grid};

/// The fraction of a sample rate usable before aliasing folds the spectrum back.
const ALIAS_LIMIT: f32 = 0.45;
/// Below this amplitude-modulation depth the band-limited envelope is steady; a
/// normalized noise spectrum would invent a rate, so the AM spectrum and peaks stay empty.
const MIN_AM_DEPTH: f32 = 0.02;
/// Below this pitch spread (in cents) the carrier is effectively steady for the same
/// reason; the FM spectrum and its peaks stay empty while `fm_std_cents` reports it.
const MIN_FM_STD_CENTS: f32 = 2.0;
/// Oversampling of the RMS envelope before its anti-alias filter decimates it back.
const ENVELOPE_OVERSAMPLE: usize = 4;
/// Cents resolution at which two measured FM levels count as different; exact
/// floating-point inequality is not a meaningful pitch resolution.
const FM_CENTS_STEP: f32 = 1.0;

/// The fewest samples a note needs before its own measurement is meaningful. Shorter
/// spans carry no full analysis frame, so the per-note path skips them rather than let a
/// padded frame imply a rate (D-18).
pub(super) const MIN_ANALYSIS_SAMPLES: usize = 128;

/// One analysed voiced run, ready for the shared modulation grid.
struct FmPart {
    /// The run's f0 track in cents around its median, uniformly sampled.
    cents: Vec<f32>,
    /// The **measured** (voiced) samples only: interpolated gaps are not evidence.
    measured: Vec<f32>,
    /// Cents samples per second (the fine pitch-frame rate).
    sample_rate: f32,
    start_secs: f32,
    end_secs: f32,
    peak_to_peak_cents: f32,
    std_cents: f32,
}

/// The AM/FM measurement of one slice: both spectra on one rate axis, their peaks, and
/// the depth / run readouts.
pub(super) struct ModMeasure {
    pub effective_min_hz: f32,
    pub effective_max_hz: f32,
    pub mod_freqs: Vec<f32>,
    pub am_db: Vec<f32>,
    pub fm_db: Vec<f32>,
    pub am_peaks: Vec<ModulationPeak>,
    pub fm_peaks: Vec<ModulationPeak>,
    pub am_depth: Option<f32>,
    pub am_peak_to_trough_db: Option<f32>,
    pub fm_run_start_secs: Option<f32>,
    pub fm_run_end_secs: Option<f32>,
    pub fm_rate_hz: Option<f32>,
    pub fm_peak_to_peak_cents: Option<f32>,
    pub fm_std_cents: Option<f32>,
    pub fm_reliable: bool,
    pub voiced_fraction: f32,
}

/// Measure AM/FM modulation over `mono` (M20).
pub(super) fn measure(
    mono: &[f32],
    sample_rate: u32,
    options: &ToolOptions,
    cancel: &Cancel,
) -> Result<ModMeasure, AnalysisError> {
    let rate = sample_rate.max(1);
    let duration = mono.len() as f32 / rate as f32;
    let (_times, levels, _frame, hop) =
        frame_rms(mono, rate, options.frame_ms(), options.hop_ms(), cancel)?;
    // The envelope is sampled once per hop; that is the AM spectrum's sample rate.
    let env_rate = rate as f32 / hop.max(1) as f32;
    // The raw envelope is the depth readout; above this band its grid cannot resolve.
    let am_usable = ALIAS_LIMIT * env_rate;
    let am_depth = envelope_depth(&linear_envelope(&levels));

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
    let coarse = pitch_track_with_grid(mono, rate, frame, pitch_hop, range, cancel)?;
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
    let fm = match run {
        Some(run) => fm_part(
            mono,
            rate,
            run,
            &coarse,
            coarse_hop_secs,
            options,
            range,
            cancel,
        )?,
        None => None,
    }
    .filter(|part| part.measured.len() >= MIN_FM_FRAMES);
    // A short or quantized run cannot support a rate. Its spread is still reported (it
    // is a real measurement), but `fm_reliable` says the rate is not, and no spectrum
    // or peak is invented (M21.B).
    let fm_reliable = fm
        .as_ref()
        .is_some_and(|part| fm_is_reliable(part, options.min_voiced_secs()));

    // The shared band is clamped by whichever half samples more slowly. The result
    // reports what was actually analysed.
    let requested = options.mod_range();
    let mut usable = am_usable;
    if let Some(part) = &fm {
        usable = usable.min(ALIAS_LIMIT * part.sample_rate);
    }
    let effective_min = requested.0.min(usable);
    let effective_max = requested.1.min(usable);

    // Sample the envelope faster than the analysis grid (as the frame cap allows),
    // low-pass at the band edge and decimate back, so above-band content is removed.
    let fine_ms = options.hop_ms() / ENVELOPE_OVERSAMPLE as f32;
    let (_, fine, _, fine_hop) = frame_rms(mono, rate, options.frame_ms(), fine_ms, cancel)?;
    let fine_rate = rate as f32 / fine_hop.max(1) as f32;
    let stride = (hop.max(1) as f32 / fine_hop.max(1) as f32)
        .round()
        .max(1.0) as usize;
    let am_values =
        band_limited_envelope(&linear_envelope(&fine), fine_rate, effective_max, stride);
    let am_rate = rate as f32 / (fine_hop.max(1) * stride) as f32;

    let mut result = ModMeasure {
        effective_min_hz: effective_min,
        effective_max_hz: effective_max.max(effective_min),
        mod_freqs: Vec::new(),
        am_db: Vec::new(),
        fm_db: Vec::new(),
        am_peaks: Vec::new(),
        fm_peaks: Vec::new(),
        am_depth,
        am_peak_to_trough_db: peak_to_trough(&levels),
        fm_run_start_secs: fm.as_ref().map(|part| part.start_secs),
        fm_run_end_secs: fm.as_ref().map(|part| part.end_secs),
        fm_rate_hz: None,
        fm_peak_to_peak_cents: fm.as_ref().map(|part| part.peak_to_peak_cents),
        fm_std_cents: fm.as_ref().map(|part| part.std_cents),
        fm_reliable,
        voiced_fraction,
    };

    // A sub-frame slice has no modulation to resolve. The depth gate uses the
    // band-limited series, so a modulation outside the band is not re-normalized into a
    // false in-band peak.
    if am_values.len() < 2 || effective_max <= effective_min {
        return Ok(result);
    }

    let freqs = rate_grid(effective_min, effective_max, duration);
    let mode = options.detrend();
    if envelope_depth(&am_values).is_some_and(|depth| depth >= MIN_AM_DEPTH) {
        result.am_db = spectrum(&am_values, am_rate, mode, &freqs);
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
    Ok(result)
}

/// Whether the FM residual can support a rate: the **measured** support is long enough,
/// and a track with real spread visits enough distinct cents values that it is not a
/// staircase. Interpolated gaps never count on their own. A steady run (under
/// [`MIN_FM_STD_CENTS`]) is a trustworthy answer too, so it is not rejected.
fn fm_is_reliable(part: &FmPart, min_voiced_secs: f32) -> bool {
    let measured_secs = part.measured.len() as f32 / part.sample_rate.max(1.0);
    if part.measured.len() < MIN_FM_FRAMES || measured_secs < min_voiced_secs {
        return false;
    }
    part.std_cents < MIN_FM_STD_CENTS || distinct_cents(&part.measured) >= MIN_FM_DISTINCT_CENTS
}

/// How many distinct levels the **measured** cents values visit, at [`FM_CENTS_STEP`]
/// resolution (a staircase has very few).
fn distinct_cents(values: &[f32]) -> usize {
    let mut levels: Vec<i32> = values
        .iter()
        .map(|v| (v / FM_CENTS_STEP).round() as i32)
        .collect();
    levels.sort_unstable();
    levels.dedup();
    levels.len()
}

/// Track the chosen run on a modulation-friendly grid and measure its cents depth.
#[allow(clippy::too_many_arguments)]
fn fm_part(
    mono: &[f32],
    rate: u32,
    run: VoicedRun,
    coarse: &[oxiaudio::dsp::PitchFrame],
    coarse_hop_secs: f32,
    options: &ToolOptions,
    range: (f32, f32),
    cancel: &Cancel,
) -> Result<Option<FmPart>, AnalysisError> {
    let duration = mono.len() as f32 / rate as f32;
    let (start_secs, end_secs) = run_span_secs(coarse, run, coarse_hop_secs, 0.0, duration);
    if end_secs <= start_secs {
        return Ok(None);
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
    let frames = pitch_track_with_grid(slice, rate, frame, hop, range, cancel)?;

    // The fine pass obeys the same bridge limit as the coarse one: a longer dropout
    // splits the track there instead of being interpolated across, so a coarse/fine
    // voicing disagreement cannot fabricate an FM trajectory. The run starts and ends on a
    // measured frame, so no edge trimming is needed.
    let fine_hop_secs = hop.max(1) as f32 / rate as f32;
    let Some(retained) = longest_voiced_run(&frames, fine_hop_secs, 0.0) else {
        return Ok(None);
    };
    let track = cents_track(&frames, retained);
    if track.series.len() < 2 {
        return Ok(None);
    }
    let centred = detrended(&track.series, options.detrend());
    let (peak_to_peak_cents, std_cents) = depth(&centred);
    // Provenance is the retained fine support, not the wider coarse slice that was fed
    // to the tracker.
    let slice_start = first as f32 / rate as f32;
    let (start_secs, end_secs) =
        run_span_secs(&frames, retained, fine_hop_secs, slice_start, duration);

    Ok(Some(FmPart {
        cents: track.series,
        measured: track.measured,
        sample_rate: rate as f32 / hop.max(1) as f32,
        start_secs,
        end_secs,
        peak_to_peak_cents,
        std_cents,
    }))
}

/// The source-second span a run's frames cover: each frame centre ± half a hop, offset
/// by the analysed slice's start and clamped to the signal.
fn run_span_secs(
    frames: &[oxiaudio::dsp::PitchFrame],
    run: VoicedRun,
    hop_secs: f32,
    offset_secs: f32,
    duration: f32,
) -> (f32, f32) {
    let start =
        (offset_secs + frames[run.first].time_seconds as f32 - hop_secs / 2.0).clamp(0.0, duration);
    let end = (offset_secs + frames[run.last].time_seconds as f32 + hop_secs / 2.0)
        .clamp(start, duration);
    (start, end)
}

/// `(max − min) / (max + min)` of the linear envelope, when it has any level.
fn envelope_depth(values: &[f32]) -> Option<f32> {
    let min = values.iter().copied().reduce(f32::min)?;
    let max = values.iter().copied().reduce(f32::max)?;
    if !(min.is_finite() && max.is_finite()) || max + min <= 0.0 {
        return None;
    }
    Some(((max - min) / (max + min)).clamp(0.0, 1.0))
}

/// Peak-to-trough range of the frame-RMS levels, in dB (0 for no frames).
fn peak_to_trough(levels: &[f32]) -> Option<f32> {
    let min = levels.iter().copied().reduce(f32::min)?;
    let max = levels.iter().copied().reduce(f32::max)?;
    Some((max - min).max(0.0))
}

#[cfg(test)]
mod tests;
