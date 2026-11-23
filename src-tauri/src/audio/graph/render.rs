//! PCM entry points built on [`build`]: apply a filter graph to a mono buffer, or
//! render a synth graph to PCM.
//!
//! A graph may declare **several output channels** (one `output` node per channel, each
//! with a `Ch` parameter). A filter graph is picked channel by channel
//! ([`apply_channel`]); a synth render keeps every channel as an interleaved source
//! buffer ([`render_pcm`]) — or averages them when the caller has only one channel to
//! fill ([`render_mono`]).

use fundsp::prelude64::{AudioUnit, Net};

use super::{build, GraphError, GraphSpec};

/// Apply a filter graph to mono PCM (sample-for-sample), **averaging** every output
/// channel. Used where the caller has only one channel to fill (a stereo pair, a render).
pub fn apply_mono(
    spec: &GraphSpec,
    input: &[f32],
    sample_rate: u32,
) -> Result<Vec<f32>, GraphError> {
    apply_channel(spec, input, sample_rate, None)
}

/// Apply a filter graph to mono PCM and keep **every** output channel, interleaved.
///
/// This is what the Timeline draws when the graph declares more than one output: one
/// lane per output channel, so every branch of the graph is visible at once.
pub fn apply_channels(
    spec: &GraphSpec,
    input: &[f32],
    sample_rate: u32,
) -> Result<(Vec<f32>, usize), GraphError> {
    let mut net = build(spec, 1, sample_rate)?;
    net.reset();
    let outputs = net.outputs().max(1);
    let mut frame = vec![0.0f32; outputs];
    let mut output = Vec::with_capacity(input.len() * outputs);
    for &sample in input {
        net.tick(&[sample], &mut frame);
        output.extend_from_slice(&frame);
    }
    Ok((output, outputs))
}

/// Apply a filter graph to mono PCM and keep **one** of its output channels.
///
/// `pick` is a 0-based output-channel index; `None` (the "downmix" pick) or an index the
/// graph does not declare averages every channel, so the result degrades to [`apply_mono`]
/// instead of going silent.
pub fn apply_channel(
    spec: &GraphSpec,
    input: &[f32],
    sample_rate: u32,
    pick: Option<usize>,
) -> Result<Vec<f32>, GraphError> {
    let mut net = build(spec, 1, sample_rate)?;
    net.reset();
    let outputs = net.outputs().max(1);
    let select = pick.filter(|channel| *channel < outputs);
    let mut frame = vec![0.0f32; outputs];
    let mut output = Vec::with_capacity(input.len());
    for &sample in input {
        net.tick(&[sample], &mut frame);
        output.push(match select {
            Some(channel) => frame[channel],
            None => mean(&frame),
        });
    }
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
