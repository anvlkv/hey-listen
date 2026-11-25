//! The `sequence` node: a note table played through a nested voice graph.
//!
//! fundsp's `Sequencer` is a plain `AudioUnit`, so it drops into a `Net` like any other
//! node — no frontend/backend split is needed for offline or live playback. Each note
//! builds its own copy of the voice net and feeds it the note's frequency, so notes
//! overlap (polyphony) and each voice's own envelopes are note-relative.
//!
//! fundsp 0.23 has only `ReplayMode::{All, None}`, so the `Loop` parameter is a wrapper
//! that restarts the sequencer at the period — `ReplayMode::All` already re-queues every
//! past event on `reset`.

use fundsp::prelude64::*;

use super::compile::build_scoped;
use super::{GraphError, GraphNode};

/// One scheduled note from a `sequence` node's table tail.
struct Note {
    start: f32,
    duration: f32,
    pitch: f32,
    velocity: f32,
}

/// The note rows from a `sequence` node's table tail: `start, dur, midi, vel`.
fn notes(node: &GraphNode) -> Vec<Note> {
    super::nodes::table_rows(node, "sequence")
        .as_chunks::<4>()
        .0
        .iter()
        .map(|row| Note {
            start: row[0],
            duration: row[1],
            pitch: row[2],
            velocity: row[3],
        })
        .collect()
}

/// A sequencer that restarts every `period` seconds.
#[derive(Clone)]
struct LoopingSequencer {
    sequencer: Sequencer,
    period: f64,
}

impl LoopingSequencer {
    fn wrap(&mut self) {
        if self
            .sequencer
            .time()
            .is_some_and(|time| time >= self.period)
        {
            self.sequencer.reset();
        }
    }
}

impl AudioUnit for LoopingSequencer {
    fn reset(&mut self) {
        self.sequencer.reset();
    }

    fn set_sample_rate(&mut self, sample_rate: f64) {
        self.sequencer.set_sample_rate(sample_rate);
    }

    fn tick(&mut self, input: &[f32], output: &mut [f32]) {
        self.wrap();
        self.sequencer.tick(input, output);
    }

    fn process(&mut self, size: usize, _input: &BufferRef, output: &mut BufferMut) {
        // One `tick` per sample, so the loop seam lands on the sample, not the block.
        for index in 0..size {
            self.wrap();
            let mut frame = [0.0f32; 1];
            self.sequencer.tick(&[], &mut frame);
            output.set_f32(0, index, frame[0]);
        }
    }

    fn inputs(&self) -> usize {
        0
    }

    fn outputs(&self) -> usize {
        1
    }

    fn route(&mut self, input: &SignalFrame, _frequency: f64) -> SignalFrame {
        Routing::Generator(0.0).route(input, 1)
    }

    fn allocate(&mut self) {
        self.sequencer.allocate();
    }

    fn footprint(&self) -> usize {
        core::mem::size_of::<Self>()
    }

    fn get_id(&self) -> u64 {
        65
    }
}

/// Build the `sequence` unit: one voice net per note, scheduled on a `Sequencer`.
///
/// `loop_seconds` is the node's `Loop` param: `0` plays the table once.
pub(super) fn make_unit(
    node: &GraphNode,
    loop_seconds: f32,
    scope: &str,
    sample_rate: u32,
) -> Result<Box<dyn AudioUnit>, GraphError> {
    let inner = node
        .subgraph
        .as_deref()
        .ok_or_else(|| GraphError::MissingSubsystem(node.id.clone()))?;
    let mut sequencer = Sequencer::new(0, 1, ReplayMode::All);
    let rate = f64::from(sample_rate);
    for (index, note) in notes(node).into_iter().enumerate() {
        // One voice net per note. The scope is deliberately **not** a `system:` tab
        // scope: a voice is a compile-time instantiation, so the parent's
        // `snoop::clear_scope` already wipes it on the next rebuild.
        let voice_scope = format!("{scope}/{}/note-{index}", node.id);
        let net = build_scoped(inner, 1, sample_rate, &voice_scope)?;
        // A voice is wrapped in a 1-in/1-out unit, so its inner graph must be exactly that.
        if net.inputs() != 1 || net.outputs() != 1 {
            return Err(GraphError::SubsystemAnchors(node.id.clone()));
        }
        let voice = unit::<U1, U1>(Box::new(net));
        let hz = midi_hz(f64::from(note.pitch)) as f32;
        let start = f64::from(note.start.max(0.0));
        // `Sequencer::push` requires each fade to fit inside the note.
        let duration = f64::from(note.duration).max(1.0 / rate);
        let fade = (duration * 0.25).min(0.01);
        sequencer.push(
            start,
            start + duration,
            Fade::Smooth,
            fade,
            fade,
            Box::new((dc(hz) >> voice) * note.velocity.max(0.0)),
        );
    }
    let period = f64::from(loop_seconds);
    if period > 0.0 {
        Ok(Box::new(LoopingSequencer { sequencer, period }))
    } else {
        Ok(Box::new(sequencer))
    }
}
