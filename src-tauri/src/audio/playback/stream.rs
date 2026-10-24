//! The cpal output stream: shared play state, the stream worker thread, and the
//! per-sample-type stream builders.
//!
//! `cpal::Stream` is `!Send` on macOS, so it lives on this dedicated worker thread
//! (see the module docs in [`super`]); the audio callback and the command side share
//! only the [`PlayState`] behind an `Arc<Mutex<_>>` and a small control channel.

use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};

use super::PlaybackError;

/// The mono buffer and cursor shared with the audio callback.
pub(super) struct PlayState {
    /// Mono samples at [`PlayState::rate`].
    pub(super) pcm: Vec<f32>,
    pub(super) rate: u32,
    pub(super) start_frame: usize,
    pub(super) end_frame: usize,
    pub(super) pos: usize,
    pub(super) playing: bool,
    pub(super) loop_region: bool,
    pub(super) gain: f32,
    /// Source-time (seconds) of the region start, for position reporting.
    pub(super) start_secs: f64,
    /// Peak magnitude of the last output block, for the preview output meter.
    pub(super) level: f32,
}

impl Default for PlayState {
    fn default() -> Self {
        Self {
            pcm: Vec::new(),
            rate: 0,
            start_frame: 0,
            end_frame: 0,
            pos: 0,
            playing: false,
            loop_region: false,
            gain: 1.0,
            start_secs: 0.0,
            level: 0.0,
        }
    }
}

pub(super) enum Control {
    /// Switch output device. `ready` carries back the sample rate of whichever
    /// stream is live after the attempt (the new one, or the retained old one).
    Rebuild {
        device: Option<String>,
        ready: Sender<u32>,
    },
    Shutdown,
}

pub(super) struct Worker {
    pub(super) control: Sender<Control>,
    pub(super) thread: std::thread::JoinHandle<()>,
    pub(super) device_rate: u32,
    pub(super) device: Option<String>,
}

pub(super) fn worker_loop(
    shared: Arc<Mutex<PlayState>>,
    commands: Receiver<Control>,
    ready: Sender<Result<u32, PlaybackError>>,
    initial: Option<String>,
) {
    let (mut stream, mut rate) = match build_stream(initial.as_deref(), shared.clone()) {
        Ok((stream, rate)) => {
            let _ = ready.send(Ok(rate));
            (stream, rate)
        }
        Err(err) => {
            let _ = ready.send(Err(err));
            return;
        }
    };

    while let Ok(command) = commands.recv() {
        match command {
            Control::Shutdown => break,
            Control::Rebuild { device, ready } => {
                // Keep the previous stream (and its rate) if the new device cannot be
                // opened, and always report the rate now in effect.
                if let Ok((next, next_rate)) = build_stream(device.as_deref(), shared.clone()) {
                    stream = next;
                    rate = next_rate;
                }
                let _ = ready.send(rate);
            }
        }
    }

    drop(stream);
}

fn build_stream(
    device_id: Option<&str>,
    shared: Arc<Mutex<PlayState>>,
) -> Result<(cpal::Stream, u32), PlaybackError> {
    let host = cpal::default_host();
    let device = match device_id {
        Some(name) => host
            .output_devices()
            .ok()
            .and_then(|mut iter| iter.find(|device| device.name().ok().as_deref() == Some(name))),
        None => host.default_output_device(),
    }
    .ok_or(PlaybackError::NoDevice)?;

    let supported = device
        .default_output_config()
        .map_err(|err| PlaybackError::Device(err.to_string()))?;
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let rate = config.sample_rate.0;

    let stream = match sample_format {
        SampleFormat::F32 => build_typed::<f32>(&device, &config, shared)?,
        SampleFormat::F64 => build_typed::<f64>(&device, &config, shared)?,
        SampleFormat::I8 => build_typed::<i8>(&device, &config, shared)?,
        SampleFormat::I16 => build_typed::<i16>(&device, &config, shared)?,
        SampleFormat::I32 => build_typed::<i32>(&device, &config, shared)?,
        SampleFormat::I64 => build_typed::<i64>(&device, &config, shared)?,
        SampleFormat::U8 => build_typed::<u8>(&device, &config, shared)?,
        SampleFormat::U16 => build_typed::<u16>(&device, &config, shared)?,
        SampleFormat::U32 => build_typed::<u32>(&device, &config, shared)?,
        SampleFormat::U64 => build_typed::<u64>(&device, &config, shared)?,
        other => {
            return Err(PlaybackError::Device(format!(
                "unsupported output sample format: {other:?}"
            )))
        }
    };

    stream
        .play()
        .map_err(|err| PlaybackError::Device(err.to_string()))?;
    Ok((stream, rate))
}

fn build_typed<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    shared: Arc<Mutex<PlayState>>,
) -> Result<cpal::Stream, PlaybackError>
where
    T: SizedSample + FromSample<f32> + Send + 'static,
{
    let channels = config.channels as usize;
    let error_callback = |err| log::error!("playback stream error: {err}");
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                let mut state = shared.lock().unwrap_or_else(|poison| poison.into_inner());
                fill(&mut state, data, channels);
            },
            error_callback,
            None,
        )
        .map_err(|err| PlaybackError::Device(err.to_string()))
}

/// Bottom of the preview meter's −60 dBFS scale (see the frontend's `lib/format.ts`).
const METER_FLOOR: f32 = 0.001;

/// Fill an output buffer by duplicating the mono signal across every channel, and
/// track the block's peak magnitude for the output meter.
fn fill<T: Sample + FromSample<f32>>(state: &mut PlayState, data: &mut [T], channels: usize) {
    let mut peak = 0.0f32;
    for frame in data.chunks_mut(channels.max(1)) {
        let sample = next_sample(state);
        let magnitude = sample.abs();
        if magnitude > peak {
            peak = magnitude;
        }
        let value = T::from_sample(sample);
        for slot in frame.iter_mut() {
            *slot = value;
        }
    }
    // Hold the block peak, then decay so the meter still falls back between blocks.
    // Snap to silence at the floor so a quiet passage cannot decay into denormals.
    let level = peak.max(state.level * 0.85);
    state.level = if level < METER_FLOOR { 0.0 } else { level };
}

fn next_sample(state: &mut PlayState) -> f32 {
    if !state.playing || state.pcm.is_empty() {
        return 0.0;
    }
    if state.pos >= state.end_frame {
        if state.loop_region && state.end_frame > state.start_frame {
            state.pos = state.start_frame;
        } else {
            state.playing = false;
            return 0.0;
        }
    }
    let value = state.pcm[state.pos] * state.gain;
    state.pos += 1;
    value
}
