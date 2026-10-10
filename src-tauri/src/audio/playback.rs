//! Preview playback over `cpal` (ADR-9).
//!
//! The Rust core owns the output stream: one stream is kept open and fed from a
//! mono buffer that the frontend loads per preview region. Control is
//! fire-and-forget (load / stop / gain), so scrubbing pays neither stream-open nor
//! IPC latency, and what you hear is the core's (filtered) signal — the same one
//! the analyzers see from M4.
//!
//! `cpal::Stream` is `!Send` on macOS, so it lives on a dedicated worker thread;
//! the audio callback and the command side share only an `Arc<Mutex<PlayState>>`
//! and a small control channel.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};
use serde::Serialize;

/// Errors produced while playing preview audio.
#[derive(Debug, thiserror::Error)]
pub enum PlaybackError {
    #[error("no audio output device is available")]
    NoDevice,
    #[error("the audio output device failed: {0}")]
    Device(String),
    #[error("could not start the playback thread: {0}")]
    Control(String),
    #[error("there is no audio source to preview")]
    NoSource,
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(PlaybackError);

/// An output device the user can preview through.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OutputDeviceDto {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// The mono buffer and cursor shared with the audio callback.
struct PlayState {
    /// Mono samples at [`PlayState::rate`].
    pcm: Vec<f32>,
    rate: u32,
    start_frame: usize,
    end_frame: usize,
    pos: usize,
    playing: bool,
    loop_region: bool,
    gain: f32,
    /// Source-time (seconds) of the region start, for position reporting.
    start_secs: f64,
    /// Peak magnitude of the last output block, for the preview output meter.
    level: f32,
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

enum Control {
    /// Switch output device. `ready` carries back the sample rate of whichever
    /// stream is live after the attempt (the new one, or the retained old one).
    Rebuild {
        device: Option<String>,
        ready: Sender<u32>,
    },
    Shutdown,
}

struct Worker {
    control: Sender<Control>,
    thread: JoinHandle<()>,
    device_rate: u32,
    device: Option<String>,
}

/// The process-wide preview player. Cheap to construct; the output stream is
/// opened lazily on the first [`ensure_started`](Self::ensure_started).
pub struct Playback {
    shared: Arc<Mutex<PlayState>>,
    worker: Mutex<Option<Worker>>,
}

impl Playback {
    pub fn new() -> Self {
        Self {
            shared: Arc::new(Mutex::new(PlayState::default())),
            worker: Mutex::new(None),
        }
    }

    /// Open the output stream if it is not already running (switching device when a
    /// new one is requested), returning its rate.
    pub fn ensure_started(&self, device: Option<String>) -> Result<u32, PlaybackError> {
        let mut worker = self
            .worker
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(worker) = worker.as_mut() {
            if worker.device != device {
                // Ask the worker to rebuild and wait for the new stream's true rate.
                // A switch to a device with a different sample rate must be reflected
                // in what we return (callers like `preview_region` resample to it).
                //
                // Blocking here is safe: the worker never locks `self.worker`, and the
                // `!Send` `cpal::Stream` stays on the worker thread, so there is no
                // deadlock and no stream on a command-side lock. If the rebuild fails
                // the worker keeps the previous stream and reports its (unchanged) rate.
                let (ready_tx, ready_rx) = mpsc::channel::<u32>();
                if worker
                    .control
                    .send(Control::Rebuild {
                        device: device.clone(),
                        ready: ready_tx,
                    })
                    .is_ok()
                {
                    if let Ok(rate) = ready_rx.recv() {
                        worker.device_rate = rate;
                    }
                }
                worker.device = device;
            }
            return Ok(worker.device_rate);
        }

        let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, PlaybackError>>();
        let (control, commands) = mpsc::channel::<Control>();
        let shared = self.shared.clone();
        let thread_device = device.clone();
        let handle = thread::Builder::new()
            .name("hey-listen-playback".to_string())
            .spawn(move || worker_loop(shared, commands, ready_tx, thread_device))
            .map_err(|err| PlaybackError::Control(err.to_string()))?;

        match ready_rx.recv() {
            Ok(Ok(rate)) => {
                *worker = Some(Worker {
                    control,
                    thread: handle,
                    device_rate: rate,
                    device,
                });
                Ok(rate)
            }
            Ok(Err(err)) => {
                let _ = handle.join();
                Err(err)
            }
            Err(_) => {
                let _ = handle.join();
                Err(PlaybackError::NoDevice)
            }
        }
    }

    /// Load a mono buffer (already at the device rate) and start looping/playing
    /// `start_secs..end_secs`. `start_secs`/`end_secs` are relative to the buffer.
    pub fn load(
        &self,
        mono: Vec<f32>,
        rate: u32,
        start_secs: f64,
        end_secs: f64,
        loop_region: bool,
    ) {
        let mut state = self
            .shared
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let frames = mono.len();
        let start = ((start_secs.max(0.0) * f64::from(rate)).round() as usize).min(frames);
        let mut end = ((end_secs.max(0.0) * f64::from(rate)).round() as usize).min(frames);
        if end <= start {
            end = frames;
        }
        state.playing = !mono.is_empty();
        state.pcm = mono;
        state.rate = rate;
        state.start_frame = start;
        state.end_frame = end;
        state.pos = start;
        state.start_secs = start_secs.max(0.0);
        state.loop_region = loop_region;
        state.level = 0.0;
    }

    pub fn stop(&self) {
        let mut state = self
            .shared
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        state.playing = false;
        state.level = 0.0;
    }

    pub fn set_gain(&self, gain: f32) {
        let mut state = self
            .shared
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        state.gain = if gain.is_finite() { gain.max(0.0) } else { 1.0 };
    }

    /// Current source-time position (seconds) while playing, else `None`.
    pub fn position(&self) -> Option<f64> {
        let state = self
            .shared
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if !state.playing || state.rate == 0 {
            return None;
        }
        let elapsed = state.pos.saturating_sub(state.start_frame) as f64 / f64::from(state.rate);
        Some(state.start_secs + elapsed)
    }

    /// Peak magnitude (0..) of the most recent output block while playing, else `0`.
    /// Drives the preview output meter in the toolbar.
    pub fn level(&self) -> f32 {
        let state = self
            .shared
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if state.playing {
            state.level
        } else {
            0.0
        }
    }
}

impl Default for Playback {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Playback {
    fn drop(&mut self) {
        if let Some(worker) = self
            .worker
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take()
        {
            let _ = worker.control.send(Control::Shutdown);
            let _ = worker.thread.join();
        }
    }
}

/// Enumerate the available output devices (the default one first).
pub fn list_output_devices() -> Vec<OutputDeviceDto> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|device| device.name().ok());
    let mut devices = Vec::new();
    if let Ok(iter) = host.output_devices() {
        for device in iter {
            if let Ok(name) = device.name() {
                let is_default = default_name.as_deref() == Some(name.as_str());
                devices.push(OutputDeviceDto {
                    id: name.clone(),
                    name,
                    is_default,
                });
            }
        }
    }
    // Default device first, then alphabetical.
    devices.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.name.cmp(&b.name))
    });
    devices
}

fn worker_loop(
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
    state.level = peak.max(state.level * 0.85);
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
