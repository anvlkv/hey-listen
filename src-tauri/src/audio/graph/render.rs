//! PCM entry points built on [`build`]: apply a filter graph to a mono buffer, or
//! render a synth graph to a mono buffer.

use fundsp::prelude64::AudioUnit;

use super::{build, GraphError, GraphSpec};

/// Apply a filter graph to mono PCM (sample-for-sample), returning the filtered
/// signal. Used before preview and (from M4) before analysis.
pub fn apply_mono(
    spec: &GraphSpec,
    input: &[f32],
    sample_rate: u32,
) -> Result<Vec<f32>, GraphError> {
    let mut net = build(spec, 1, sample_rate)?;
    net.reset();
    let mut output = Vec::with_capacity(input.len());
    for &sample in input {
        output.push(net.filter_mono(sample));
    }
    Ok(output)
}

/// Render a synth graph to mono PCM (`seconds` at `sample_rate`).
pub fn render_mono(
    spec: &GraphSpec,
    seconds: f64,
    sample_rate: u32,
) -> Result<Vec<f32>, GraphError> {
    let frames = (seconds.max(0.0) * f64::from(sample_rate)).round() as usize;
    let mut net = build(spec, 0, sample_rate)?;
    net.reset();
    let mut output = Vec::with_capacity(frames);
    for _ in 0..frames {
        output.push(net.get_mono());
    }
    Ok(output)
}
