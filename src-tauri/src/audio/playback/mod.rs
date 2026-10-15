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
//!
//! The implementation is split into focused submodules: [`stream`] holds the shared
//! play state and the cpal worker thread; this module owns the [`Playback`] handle,
//! the control channel, the error/DTO types, and device enumeration.

mod stream;

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;

use stream::{worker_loop, Control, PlayState, Worker};

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
