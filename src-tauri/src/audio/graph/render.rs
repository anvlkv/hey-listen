//! PCM entry points built on [`build`]: apply a filter graph to interleaved source PCM,
//! or render a synth graph to PCM.
//!
//! A filter graph reads the source channel each of its `input` nodes names (its `Ch`
//! param, `-1` downmixing) and may declare **several output channels** (one `output` node
//! per channel, each with a `Ch` parameter). A filter graph is picked channel by channel
//! ([`apply_channel`]); a synth render keeps every channel as an interleaved source
//! buffer ([`render_pcm`]) — or averages them when the caller has only one channel to
//! fill ([`render_mono`]).

use fundsp::prelude64::{AudioUnit, Net};

use crate::audio::pcm;

use super::{build, GraphError, GraphSpec};

/// Apply a filter graph to **mono** PCM (sample-for-sample), **averaging** every output
/// channel. Used where the caller has only one channel to give the graph (a stereo pair
/// rendered one side at a time) or only one channel to fill.
pub fn apply_mono(
    spec: &GraphSpec,
    input: &[f32],
    sample_rate: u32,
) -> Result<Vec<f32>, GraphError> {
    apply_channel(spec, input, 1, sample_rate, None)
}

/// Apply a filter graph to **interleaved** source PCM and keep **every** output channel,
/// interleaved.
///
/// This is what the Timeline draws when the graph declares more than one output: one
/// lane per output channel, so every branch of the graph is visible at once.
pub fn apply_channels(
    spec: &GraphSpec,
    input: &[f32],
    channels: usize,
    sample_rate: u32,
) -> Result<(Vec<f32>, usize), GraphError> {
    let mut output = Vec::new();
    let outputs = run(spec, input, channels, sample_rate, |frame| {
        output.extend_from_slice(frame);
    })?;
    Ok((output, outputs))
}

/// Apply a filter graph to **interleaved** source PCM and keep **one** of its output
/// channels.
///
/// `channels` is the interleaved source's channel count: each `input` node reads the
/// channel its `Ch` param names, so the graph — not this pick — decides what it hears.
/// `pick` is a 0-based **output**-channel index; `None` (the "downmix" pick) or an index
/// the graph does not declare averages every channel, so the result degrades to
/// [`apply_mono`] instead of going silent.
pub fn apply_channel(
    spec: &GraphSpec,
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    pick: Option<usize>,
) -> Result<Vec<f32>, GraphError> {
    let mut output = Vec::new();
    run(spec, input, channels, sample_rate, |frame| {
        output.push(match pick.filter(|channel| *channel < frame.len()) {
            Some(channel) => frame[channel],
            None => mean(frame),
        });
    })?;
    Ok(output)
}

/// Render a synth graph to **interleaved** PCM (one sample per output channel per
/// frame), plus the channel count. This is what becomes a synth source.
pub fn render_pcm(
    spec: &GraphSpec,
    seconds: f64,
    sample_rate: u32,
) -> Result<(Vec<f32>, usize), GraphError> {
    let mut net = build(spec, 0, sample_rate)?;
    net.reset();
    Ok(render_frames(&mut net, frames(seconds, sample_rate)))
}

/// Render a synth graph to **mono** PCM (`seconds` at `sample_rate`), averaging channels.
pub fn render_mono(
    spec: &GraphSpec,
    seconds: f64,
    sample_rate: u32,
) -> Result<Vec<f32>, GraphError> {
    let (pcm, channels) = render_pcm(spec, seconds, sample_rate)?;
    Ok(to_mono(&pcm, channels))
}

/// Drive a filter graph over interleaved source PCM, handing each output frame to
/// `sink`; returns the graph's output-channel count.
///
/// Each `input` node receives `Global(i)` in node order (see
/// [`input_channels`](super::input_channels)), filled from the source channel its `Ch`
/// names.
fn run<F>(
    spec: &GraphSpec,
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    mut sink: F,
) -> Result<usize, GraphError>
where
    F: FnMut(&[f32]),
{
    let channels = channels.max(1);
    let picks = super::input_channels(spec)?;
    let mut net = build(spec, 1, sample_rate)?;
    net.reset();
    let outputs = net.outputs().max(1);
    let mut frame_in = vec![0.0f32; net.inputs()];
    let mut frame_out = vec![0.0f32; outputs];
    for frame in 0..input.len() / channels {
        for (index, pick) in picks.iter().enumerate() {
            if let Some(slot) = frame_in.get_mut(index) {
                *slot = pcm::mixdown_frame(input, channels, frame, *pick);
            }
        }
        net.tick(&frame_in, &mut frame_out);
        sink(&frame_out);
    }
    Ok(outputs)
}

/// Average interleaved `channels`-channel PCM down to mono.
pub(super) fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved.chunks(channels).map(mean).collect()
}

/// The average of one output frame (`outputs` is never 0).
fn mean(frame: &[f32]) -> f32 {
    frame.iter().sum::<f32>() / frame.len().max(1) as f32
}

/// The number of frames `seconds` covers at `sample_rate`.
pub(super) fn frames(seconds: f64, sample_rate: u32) -> usize {
    (seconds.max(0.0) * f64::from(sample_rate)).round() as usize
}

/// Walk the net one sample at a time, writing every output channel interleaved.
///
/// A synth **source** render is sample-exact by construction: what the analysis sees does
/// not depend on the block schedule, so the samples stay comparable across app versions.
pub(super) fn render_frames(net: &mut Net, frames: usize) -> (Vec<f32>, usize) {
    let outputs = net.outputs().max(1);
    let mut frame = vec![0.0f32; outputs];
    let mut output = Vec::with_capacity(frames * outputs);
    for _ in 0..frames {
        net.tick(&[], &mut frame);
        output.extend_from_slice(&frame);
    }
    (output, outputs)
}
