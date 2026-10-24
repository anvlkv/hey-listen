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

/// `(frame_samples, hop_samples)` for a note's own pitch grid: at least the requested
/// frame, raised to ~3 periods of `min_f0_hz` (capped) so low calls have enough cycles.
pub(super) fn note_pitch_grid(
    len: usize,
    sample_rate: u32,
    frame_ms: f32,
    hop_ms: f32,
    min_f0_hz: f32,
) -> (usize, usize) {
    let rate = f64::from(sample_rate.max(1));
    let requested = ((f64::from(frame_ms) / 1_000.0) * rate).round().max(1.0) as usize;
    let three_periods = (3.0 * rate / f64::from(min_f0_hz.max(1.0))).ceil() as usize;
    let frame = requested
        .max(three_periods.min(MAX_NOTE_PITCH_FRAME))
        .max(2);
    let requested_hop = ((f64::from(hop_ms) / 1_000.0) * rate).round().max(1.0) as usize;
    let hop = requested_hop.max(len.div_ceil(MAX_NOTE_PITCH_FRAMES).max(1));
    (frame, hop)
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
    let (frame, hop) = note_pitch_grid(mono.len(), sample_rate, frame_ms, hop_ms, range.0);
    let padded = pad_to(mono, frame);
    let buf = mono_buffer(&padded, sample_rate);
    let frames = PitchTracker::new(frame, hop)
        .with_range(range.0, range.1)
        .track(&buf);
    (frames, frame, hop)
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
