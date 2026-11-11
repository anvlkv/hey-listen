//! pYIN with an **explicit** f0 search range.
//!
//! `oxiaudio` 0.2's `detect_pitch_pyin` hardcodes a 50–2000 Hz search window (its tau
//! bounds are fixed), which excludes the high fundamentals of most bird vocalisations and
//! makes cross-tracker agreement unevaluable above 2 kHz (hey-listen-report §2.2/§6.2).
//! The crate exposes no ranged pYIN, so this is the same algorithm — YIN candidates
//! weighted by a Beta(2, 18) threshold prior, then a Viterbi pass over semitone bins — with
//! the tau bounds, and the bins kept, taken from the tool's `minF0Hz`/`maxF0Hz`.
//!
//! The pitch *bins* are the crate's semitone grid (A0 = 27.5 Hz, 108 bins to B8), so a
//! reported f0 is quantized to a semitone like the crate's own pYIN. Only bins whose
//! **centre** lies inside the requested range are reportable; when a range is thinner than
//! the grid (or the frame cannot realize it), nothing is reported and
//! [`effective_range`] says so rather than echoing the request.

use oxiaudio::dsp::PitchFrame;
use oxiaudio::AudioBuffer;

use crate::audio::analysis::CandidateGrid;

mod candidates;

/// Semitone bins spanning A0–B8 (MIDI-like), as in the reference implementation.
const N_BINS: usize = 108;
/// The lowest bin's centre frequency (A0).
const BIN_BASE_HZ: f64 = 27.5;
/// Beta(α, β) parameters for the threshold weighting.
const BETA_A: f64 = 2.0;
const BETA_B: f64 = 18.0;
/// Voiced-to-voiced (same bin) transition probability.
const VOICED_VOICED_SAME: f64 = 0.99;
/// Geometric decay per semitone step.
const PITCH_STEP_DECAY: f64 = 0.7;
/// Voiced-to-unvoiced / unvoiced-to-voiced transition probabilities.
const VOICED_UNVOICED: f64 = 0.01;
const UNVOICED_UNVOICED: f64 = 0.99;
/// Probability floor before taking the log (avoids `log(0)`).
const LOG_FLOOR: f64 = 1e-30;

/// The detector's output: one frame per hop, plus the candidate evidence behind each
/// frame's choice.
#[derive(Default)]
pub(super) struct PyinOutput {
    pub frames: Vec<PitchFrame>,
    /// Frame-major `frames × N_BINS` candidate probabilities, aligned with `frames`.
    pub candidates: CandidateGrid,
    /// Parallel to `frames`: a comparable octave-away candidate competes with the choice.
    pub octave_ambiguous: Vec<bool>,
}

/// Detect f0 with pYIN over `min_f0..max_f0` Hz.
///
/// `buf` must already be the mono signal the engine analyses. Returns one frame per hop,
/// with unvoiced frames having `frequency_hz == 0.0`, and the per-frame candidate grid
/// those frames were chosen from (see the `candidates` module).
pub(super) fn detect(
    buf: &AudioBuffer<f32>,
    frame_size: usize,
    hop_size: usize,
    min_f0: f32,
    max_f0: f32,
) -> PyinOutput {
    let samples = &buf.samples;
    let sr = buf.sample_rate as f32;
    if frame_size == 0 || hop_size == 0 || sr <= 0.0 || samples.len() < frame_size {
        return PyinOutput::default();
    }
    let Some(domain) = domain(sr, frame_size, min_f0, max_f0) else {
        return PyinOutput::default();
    };
    if domain.range(sr).is_none() {
        return PyinOutput::default();
    }
    let Domain {
        tau_min,
        tau_max,
        bin_min,
        bin_max,
    } = domain;

    let hop = hop_size.max(1);
    let n_frames = (samples.len() - frame_size) / hop + 1;
    let n_states = N_BINS + 1;
    let unvoiced_state = N_BINS;

    // Per-frame candidate probabilities, accumulated over the Beta-weighted thresholds.
    let mut obs_voiced: Vec<Vec<f64>> = vec![vec![0.0; N_BINS]; n_frames];
    let mut voiced_prob = vec![0.0f64; n_frames];
    let thresholds: Vec<f32> = (1..=19).map(|i| i as f32 * 0.05).collect();
    let threshold_weights = beta_weights(&thresholds);

    for frame_index in 0..n_frames {
        let start = frame_index * hop;
        let frame = &samples[start..start + frame_size];
        // The CMNDF only needs lags up to `tau_max`; a smaller table is faster.
        let cmnd = cmndf(frame, tau_max);
        for (threshold_index, &threshold) in thresholds.iter().enumerate() {
            let Some(tau) = first_minimum(&cmnd, tau_min, tau_max, threshold) else {
                continue;
            };
            let refined = parabolic(&cmnd, tau);
            if refined <= 0.0 {
                continue;
            }
            let frequency = sr / refined;
            let bin = freq_to_bin(frequency);
            if bin < bin_min || bin > bin_max {
                continue;
            }
            let weight = threshold_weights[threshold_index] as f64;
            obs_voiced[frame_index][bin] += weight;
            voiced_prob[frame_index] += weight;
        }
    }

    // The log transition matrix: a geometric decay across semitone steps, plus the
    // voiced/unvoiced probabilities, normalized per source state.
    let mut log_trans = vec![f64::NEG_INFINITY; n_states * n_states];
    for from in 0..N_BINS {
        let mut weights = vec![0.0f64; N_BINS];
        let mut row_sum = VOICED_UNVOICED;
        for (to, weight) in weights.iter_mut().enumerate() {
            let distance = from.abs_diff(to) as i32;
            *weight = if distance == 0 {
                VOICED_VOICED_SAME
            } else {
                VOICED_VOICED_SAME * PITCH_STEP_DECAY.powi(distance)
            };
            row_sum += *weight;
        }
        for (to, &weight) in weights.iter().enumerate() {
            log_trans[from * n_states + to] = (weight / row_sum).max(LOG_FLOOR).ln();
        }
        log_trans[from * n_states + unvoiced_state] =
            (VOICED_UNVOICED / row_sum).max(LOG_FLOOR).ln();
    }
    let unvoiced_to_voiced = ((1.0 - UNVOICED_UNVOICED) / N_BINS as f64)
        .max(LOG_FLOOR)
        .ln();
    for to in 0..N_BINS {
        log_trans[unvoiced_state * n_states + to] = unvoiced_to_voiced;
    }
    log_trans[unvoiced_state * n_states + unvoiced_state] = UNVOICED_UNVOICED.max(LOG_FLOOR).ln();

    // Viterbi over the frame sequence, keeping back-pointers for the traceback.
    let observation = |frame_index: usize| -> Vec<f64> {
        let mut values = vec![f64::NEG_INFINITY; n_states];
        for bin in 0..N_BINS {
            values[bin] = obs_voiced[frame_index][bin].max(LOG_FLOOR).ln();
        }
        values[unvoiced_state] = (1.0 - voiced_prob[frame_index])
            .max(0.0)
            .max(LOG_FLOOR)
            .ln();
        values
    };

    let mut previous = vec![f64::NEG_INFINITY; n_states];
    let mut current = vec![f64::NEG_INFINITY; n_states];
    let mut back_pointers = vec![0u16; n_frames * n_states];
    {
        let first = observation(0);
        let prior = (1.0 / n_states as f64).max(LOG_FLOOR).ln();
        for state in 0..n_states {
            previous[state] = prior + first[state];
        }
    }
    for frame_index in 1..n_frames {
        let observed = observation(frame_index);
        for state in 0..n_states {
            let mut best = f64::NEG_INFINITY;
            let mut best_previous = 0usize;
            for candidate in 0..n_states {
                let score = previous[candidate] + log_trans[candidate * n_states + state];
                if score > best {
                    best = score;
                    best_previous = candidate;
                }
            }
            current[state] = best + observed[state];
            back_pointers[frame_index * n_states + state] = best_previous as u16;
        }
        previous.copy_from_slice(&current);
    }

    // Traceback from the best final state.
    let mut path = vec![0usize; n_frames];
    path[n_frames - 1] = previous
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(state, _)| state)
        .unwrap_or(unvoiced_state);
    for frame_index in (1..n_frames).rev() {
        path[frame_index - 1] = back_pointers[frame_index * n_states + path[frame_index]] as usize;
    }

    let frames = (0..n_frames)
        .map(|frame_index| {
            let time_seconds =
                ((frame_index * hop) as f64 + frame_size as f64 / 2.0) / f64::from(buf.sample_rate);
            let state = path[frame_index];
            let voiced = state != unvoiced_state && (bin_min..=bin_max).contains(&state);
            if !voiced {
                return PitchFrame {
                    time_seconds,
                    frequency_hz: 0.0,
                    confidence: 0.0,
                    is_voiced: false,
                };
            }
            let confidence = observation(frame_index)[state].exp().clamp(0.0, 1.0) as f32;
            PitchFrame {
                time_seconds,
                frequency_hz: bin_to_freq(state),
                confidence,
                is_voiced: true,
            }
        })
        .collect();
    // The evidence behind the path, normalized per frame; the rows are frame-major, so
    // they stay aligned with the returned frames.
    let candidates = candidates::grid(&obs_voiced, &voiced_prob);
    let octave_ambiguous = candidates::octave_ambiguous(&candidates, &path);
    PyinOutput {
        frames,
        candidates,
        octave_ambiguous,
    }
}

/// The f0 domain a call can actually realize: the semitone bins whose centre lies
/// inside the requested range, further limited by the lags the frame and sample rate
/// allow. `(0.0, 0.0)` means nothing in the request is representable (or realizable),
/// so no frame is reported voiced.
pub(super) fn effective_range(
    sample_rate: u32,
    frame_size: usize,
    min_f0: f32,
    max_f0: f32,
) -> (f32, f32) {
    let sr = sample_rate as f32;
    domain(sr, frame_size, min_f0, max_f0)
        .and_then(|domain| domain.range(sr))
        .unwrap_or((0.0, 0.0))
}

/// The realized search domain: the lags the CMNDF can search and the bins it may report.
#[derive(Debug, Clone, Copy)]
struct Domain {
    tau_min: usize,
    tau_max: usize,
    bin_min: usize,
    bin_max: usize,
}

impl Domain {
    /// The frequency interval this domain reports, or `None` when the lag bounds leave
    /// no room for the bins.
    fn range(&self, sample_rate: f32) -> Option<(f32, f32)> {
        let low = bin_to_freq(self.bin_min).max(sample_rate / self.tau_max as f32);
        let high = bin_to_freq(self.bin_max).min(sample_rate / self.tau_min as f32);
        (low <= high).then_some((low, high))
    }
}

/// Resolve the realized domain, or `None` when the request cannot be realized.
fn domain(sample_rate: f32, frame_size: usize, min_f0: f32, max_f0: f32) -> Option<Domain> {
    if frame_size == 0 || sample_rate <= 0.0 {
        return None;
    }
    // The search lags the requested range implies. The frame must be long enough for the
    // lowest f0, and short enough that the highest f0 has at least two samples per period.
    let tau_min = ((sample_rate / max_f0.max(1.0)).floor() as usize).max(2);
    let tau_max = ((sample_rate / min_f0.max(1.0)).ceil() as usize).min(frame_size / 2);
    if tau_max <= tau_min {
        return None;
    }
    // Rounding a range endpoint to the nearest bin can land its centre outside the
    // request, so narrow both ends until every reportable centre is inside it.
    let mut bin_min = freq_to_bin(min_f0.max(1.0));
    let mut bin_max = freq_to_bin(max_f0.max(min_f0));
    while bin_min <= bin_max && bin_centre_hz(bin_min) < f64::from(min_f0) {
        bin_min += 1;
    }
    while bin_min <= bin_max && bin_centre_hz(bin_max) > f64::from(max_f0) {
        bin_max -= 1;
    }
    (bin_min <= bin_max).then_some(Domain {
        tau_min,
        tau_max,
        bin_min,
        bin_max,
    })
}

/// Beta(2, 18) weights at the given thresholds, normalized to sum to 1.
fn beta_weights(thresholds: &[f32]) -> Vec<f32> {
    let weights: Vec<f64> = thresholds
        .iter()
        .map(|&threshold| {
            let threshold = threshold as f64;
            threshold.powf(BETA_A - 1.0) * (1.0 - threshold).powf(BETA_B - 1.0)
        })
        .collect();
    let sum: f64 = weights.iter().sum();
    if sum > 0.0 {
        weights
            .iter()
            .map(|&weight| (weight / sum) as f32)
            .collect()
    } else {
        vec![1.0 / thresholds.len() as f32; thresholds.len()]
    }
}

/// The nearest semitone bin for `frequency` (0 … [`N_BINS`] - 1).
fn freq_to_bin(frequency: f32) -> usize {
    if frequency <= 0.0 {
        return 0;
    }
    let bin = (12.0 * (frequency as f64 / BIN_BASE_HZ).log2()).round();
    bin.clamp(0.0, (N_BINS - 1) as f64) as usize
}

/// A bin's centre frequency, in the grid's own precision.
fn bin_centre_hz(bin: usize) -> f64 {
    BIN_BASE_HZ * 2.0_f64.powf(bin as f64 / 12.0)
}

/// A bin's centre frequency.
fn bin_to_freq(bin: usize) -> f32 {
    bin_centre_hz(bin) as f32
}

/// The first local minimum of the CMNDF inside `[tau_min, tau_max]` below `threshold`.
fn first_minimum(cmnd: &[f32], tau_min: usize, tau_max: usize, threshold: f32) -> Option<usize> {
    let limit = tau_max.min(cmnd.len().saturating_sub(1));
    let mut tau = tau_min;
    while tau <= limit {
        if cmnd[tau] < threshold {
            while tau < limit && cmnd[tau + 1] < cmnd[tau] {
                tau += 1;
            }
            return Some(tau);
        }
        tau += 1;
    }
    None
}

/// The cumulative mean normalized difference function, up to `tau_max`.
fn cmndf(frame: &[f32], tau_max: usize) -> Vec<f32> {
    let width = frame.len();
    let limit = tau_max.min(width.saturating_sub(1));
    let mut difference = vec![0.0f32; limit + 1];
    for tau in 1..=limit {
        let mut sum = 0.0f32;
        for index in 0..(width - tau) {
            let delta = frame[index] - frame[index + tau];
            sum += delta * delta;
        }
        difference[tau] = sum;
    }
    let mut cmnd = vec![1.0f32; limit + 1];
    let mut running = 0.0f32;
    for tau in 1..=limit {
        running += difference[tau];
        cmnd[tau] = if running > 0.0 {
            difference[tau] * tau as f32 / running
        } else {
            1.0
        };
    }
    cmnd
}

/// Parabolic interpolation of the minimum at integer lag `tau`.
fn parabolic(cmnd: &[f32], tau: usize) -> f32 {
    if tau == 0 || tau + 1 >= cmnd.len() {
        return tau as f32;
    }
    let before = cmnd[tau - 1];
    let at = cmnd[tau];
    let after = cmnd[tau + 1];
    let denominator = before - 2.0 * at + after;
    if denominator.abs() < f32::EPSILON {
        return tau as f32;
    }
    let shift = 0.5 * (before - after) / denominator;
    (tau as f32 + shift).max(1.0)
}
