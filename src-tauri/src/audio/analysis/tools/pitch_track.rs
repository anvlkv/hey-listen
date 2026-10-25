//! The range-limited YIN pitch track used by the per-note quality proxies (M19).
//!
//! A thin wrapper over `oxiaudio::dsp::PitchTracker`: the note slice gets its own
//! fine grid, so the global pitch-frame cap does not force a coarse jitter hop. M20's
//! FM half can reuse it.

use oxiaudio::dsp::{PitchFrame, PitchTracker};

use super::super::support::mono_buffer;

/// Cap on a note's pitch frame length (samples), so a very low f0 request cannot
/// allocate an unbounded analysis window.
const MAX_NOTE_PITCH_FRAME: usize = 16_384;
/// Cap on pitch frames per note. The hop widens for a long note, but short notes —
/// the ones jitter is meant for — keep the requested fine hop.
const MAX_NOTE_PITCH_FRAMES: usize = 256;

/// A duration in ms as samples (at least one).
fn samples(ms: f32, rate: f64) -> usize {
    ((f64::from(ms) / 1_000.0) * rate).round().max(1.0) as usize
}

/// The samples in ~3 periods of `f0_hz` — enough cycles for a stable YIN estimate.
fn three_periods(f0_hz: f32, rate: f64) -> usize {
    (3.0 * rate / f64::from(f0_hz.max(1.0))).ceil() as usize
}

/// Widen the hop so `len` samples yield at most `max_frames` frames.
fn bounded_grid(len: usize, frame: usize, hop: usize, max_frames: usize) -> (usize, usize) {
    let hop = hop.max(len.div_ceil(max_frames.max(1)).max(1));
    (frame.max(2), hop)
}

/// `(frame_samples, hop_samples)` for a note's own pitch grid: at least the requested
/// frame, raised to ~3 periods of `min_f0_hz` (capped) so low calls have enough cycles.
pub(super) fn note_pitch_grid(
    len: usize,
    sample_rate: u32,
    frame_ms: f32,
    hop_ms: f32,
    min_f0_hz: f32,
    max_frames: usize,
) -> (usize, usize) {
    let rate = f64::from(sample_rate.max(1));
    let periods = three_periods(min_f0_hz, rate).min(MAX_NOTE_PITCH_FRAME);
    let frame = samples(frame_ms, rate).max(periods);
    bounded_grid(len, frame, samples(hop_ms, rate), max_frames)
}

/// `(frame_samples, hop_samples)` for the FM half of `modulation` (M20): the frame is
/// **capped** at ~3 periods of `f0_hz`, so a fast modulation is not smeared by a long
/// analysis window (the requested `frame_ms` is the upper bound).
pub(super) fn modulated_pitch_grid(
    len: usize,
    sample_rate: u32,
    frame_ms: f32,
    hop_ms: f32,
    f0_hz: f32,
    max_frames: usize,
) -> (usize, usize) {
    let rate = f64::from(sample_rate.max(1));
    let periods = three_periods(f0_hz, rate).min(MAX_NOTE_PITCH_FRAME);
    let frame = samples(frame_ms, rate).min(periods);
    bounded_grid(len, frame, samples(hop_ms, rate), max_frames)
}

/// YIN pitch frames over `mono` on a note-sized grid, plus the effective
/// `(frame, hop)` in samples. A slice shorter than one frame is zero-padded so it
/// still yields a single frame.
pub(super) fn pitch_track(
    mono: &[f32],
    sample_rate: u32,
    frame_ms: f32,
    hop_ms: f32,
    range: (f32, f32),
) -> (Vec<PitchFrame>, usize, usize) {
    let (frame, hop) = note_pitch_grid(
        mono.len(),
        sample_rate,
        frame_ms,
        hop_ms,
        range.0,
        MAX_NOTE_PITCH_FRAMES,
    );
    (
        pitch_track_with_grid(mono, sample_rate, frame, hop, range),
        frame,
        hop,
    )
}

/// YIN pitch frames over `mono` on an explicit `(frame, hop)` grid, zero-padded to one
/// frame so a short slice still yields a frame.
pub(super) fn pitch_track_with_grid(
    mono: &[f32],
    sample_rate: u32,
    frame: usize,
    hop: usize,
    range: (f32, f32),
) -> Vec<PitchFrame> {
    let padded = pad_to(mono, frame);
    let buf = mono_buffer(&padded, sample_rate);
    PitchTracker::new(frame, hop)
        .with_range(range.0, range.1)
        .track(&buf)
}

/// `mono` unchanged when it is at least `len` samples, otherwise zero-padded to `len`.
///
/// The library's frame-based tools do not pad, so a note shorter than one analysis
/// frame would otherwise yield no frames at all.
pub(super) fn pad_to(mono: &[f32], len: usize) -> Vec<f32> {
    if mono.len() >= len {
        return mono.to_vec();
    }
    let mut buffer = vec![0.0f32; len];
    buffer[..mono.len()].copy_from_slice(mono);
    buffer
}
