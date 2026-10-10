//! Live capture via `flexaudio` (mic / system / process / mix).
//!
//! `flexaudio::Stream` is polled on a dedicated thread: the engine owns the stream
//! so the command layer can drive it from any thread over a small control channel
//! (pause / resume / gain / stop). Chunks and stream events are handed to a `sink`
//! callback. Keeping this module free of `tauri` types lets the command layer adapt
//! it to the IPC boundary (see `docs/architecture.md`).

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use flexaudio::{Event as FlexEvent, OutputFormat, SourceKind, Stream, StreamConfig};
use serde::Serialize;

/// Canonical capture format: flexaudio's 48 kHz / stereo pass-through (no resampling).
pub const CAPTURE_RATE: u32 = 48_000;
pub const CAPTURE_CHANNELS: u16 = 2;

/// How long the poll loop waits for the next chunk/control before re-checking.
const POLL_INTERVAL: Duration = Duration::from_millis(4);

/// Errors produced while enumerating or capturing a live source.
#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("unknown source kind: {0}")]
    UnknownKind(String),
    #[error("a process source needs a target process")]
    MissingTarget,
    #[error("capture backend error: {0}")]
    Backend(String),
    #[error("no capture is running")]
    NotRunning,
    #[error("capture control failed: {0}")]
    Control(String),
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(CaptureError);

/// Which live source to capture (mirrors [`flexaudio::SourceKind`] plus the string ids
/// the frontend uses).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureKind {
    Mic,
    System,
    Process,
    Mix,
}

impl CaptureKind {
    pub fn parse(id: &str) -> Result<Self, CaptureError> {
        match id {
            "mic" => Ok(Self::Mic),
            "system" => Ok(Self::System),
            "process" => Ok(Self::Process),
            "mix" => Ok(Self::Mix),
            other => Err(CaptureError::UnknownKind(other.to_string())),
        }
    }

    fn flexaudio(self) -> SourceKind {
        match self {
            Self::Mic => SourceKind::Mic,
            Self::System => SourceKind::SystemLoopback,
            Self::Process => SourceKind::ProcessLoopback,
            Self::Mix => SourceKind::Mix,
        }
    }
}

/// Parameters for [`start`].
#[derive(Debug, Clone)]
pub struct CaptureConfig {
    pub kind: CaptureKind,
    /// Input device (mic) or output endpoint (system); ignored by process/mix.
    pub device_id: Option<String>,
    /// Microphone side of a `Mix` capture.
    pub mix_mic_device_id: Option<String>,
    /// System side of a `Mix` capture.
    pub mix_system_device_id: Option<String>,
    /// Required for [`CaptureKind::Process`].
    pub target_pid: Option<u32>,
    /// Linear input gain (1.0 = unchanged).
    pub gain: f32,
}

/// A message from the capture poll thread to the command layer.
pub enum CaptureMessage {
    /// One 20 ms chunk of interleaved `f32` (length = frames × channels).
    Chunk(Vec<f32>),
    /// A stream event (permission, device loss, stall, …).
    Event(CaptureEvent),
}

/// A capture stream event, ready to be emitted to the frontend.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CaptureEvent {
    /// Stable id: `dropped` | `stalled` | `recovered` | `permission` | `device-lost` | `error`.
    pub kind: String,
    pub message: Option<String>,
}

/// A device that can back a mic or system source.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeviceDto {
    pub id: String,
    pub name: String,
    /// `mic` | `system`.
    pub source_kind: String,
    /// `true` for a loopback (system-output) device.
    pub is_loopback: bool,
    pub is_default: bool,
    pub sample_rate: u32,
    pub channels: u16,
}

/// A process that can back a per-process source.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProcessDto {
    pub pid: u32,
    pub name: String,
    pub executable: Option<String>,
    pub bundle_id: Option<String>,
    /// Whether audio is currently playing, when the OS exposes it.
    pub is_output_active: Option<bool>,
}

/// Enumerate capture devices (microphones + system output endpoints).
pub fn list_devices() -> Result<Vec<DeviceDto>, CaptureError> {
    let devices = flexaudio::devices().map_err(|err| CaptureError::Backend(err.to_string()))?;
    Ok(devices
        .into_iter()
        .map(|device| DeviceDto {
            id: device.id,
            name: device.name,
            source_kind: match device.source_kind {
                SourceKind::Mic => "mic",
                SourceKind::SystemLoopback => "system",
                SourceKind::ProcessLoopback => "process",
                SourceKind::Mix => "mix",
            }
            .to_string(),
            is_loopback: device.is_loopback,
            is_default: device.is_default,
            sample_rate: device.sample_rate,
            channels: device.channels,
        })
        .collect())
}

/// Enumerate processes that are candidates for per-process capture.
pub fn list_processes() -> Result<Vec<ProcessDto>, CaptureError> {
    let processes = flexaudio::processes().map_err(|err| CaptureError::Backend(err.to_string()))?;
    Ok(processes
        .into_iter()
        .map(|proc_info| ProcessDto {
            pid: proc_info.pid,
            name: proc_info.name,
            executable: proc_info.executable,
            bundle_id: proc_info.bundle_id,
            is_output_active: proc_info.is_output_active,
        })
        .collect())
}

/// Control messages for the poll thread.
enum Control {
    Pause,
    Resume,
    SetGain(f32),
    Stop,
}

/// A running capture session. Owns the poll thread and its control channel; drop or
/// [`stop`](Self::stop) to end the capture.
pub struct CaptureHandle {
    control: Sender<Control>,
    thread: Option<JoinHandle<()>>,
    pub sample_rate: u32,
    pub channels: u16,
}

impl CaptureHandle {
    /// Stop delivering chunks, keeping capture alive for a fast resume.
    pub fn pause(&self) -> Result<(), CaptureError> {
        self.send(Control::Pause)
    }

    /// Resume delivering chunks after a [`pause`](Self::pause).
    pub fn resume(&self) -> Result<(), CaptureError> {
        self.send(Control::Resume)
    }

    /// Set linear input gain (finite and ≥ 0).
    pub fn set_gain(&self, gain: f32) -> Result<(), CaptureError> {
        if !gain.is_finite() || gain < 0.0 {
            return Err(CaptureError::Control(
                "gain must be finite and >= 0".to_string(),
            ));
        }
        self.send(Control::SetGain(gain))
    }

    fn send(&self, message: Control) -> Result<(), CaptureError> {
        self.control
            .send(message)
            .map_err(|_| CaptureError::NotRunning)
    }

    /// Signal the poll thread to stop and wait for it to finish.
    pub fn stop(&mut self) {
        let _ = self.control.send(Control::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        // Make sure the capture thread is stopped even without an explicit `stop`
        // (e.g. when the app shuts down or a capture is replaced).
        self.stop();
    }
}

/// Open and start a capture, forwarding chunks/events to `sink` on the poll thread.
pub fn start(
    config: CaptureConfig,
    sink: impl FnMut(CaptureMessage) + Send + 'static,
) -> Result<CaptureHandle, CaptureError> {
    if config.kind == CaptureKind::Process && config.target_pid.is_none() {
        return Err(CaptureError::MissingTarget);
    }

    let stream_config = StreamConfig {
        kind: config.kind.flexaudio(),
        device_id: config.device_id.clone(),
        mix_mic_device_id: config.mix_mic_device_id.clone(),
        mix_system_device_id: config.mix_system_device_id.clone(),
        target_pid: config.target_pid,
        output: OutputFormat {
            sample_rate: CAPTURE_RATE,
            channels: CAPTURE_CHANNELS,
        },
        gain: config.gain,
        ..Default::default()
    };

    let mut stream =
        flexaudio::open(stream_config).map_err(|err| CaptureError::Backend(err.to_string()))?;
    stream
        .start()
        .map_err(|err| CaptureError::Backend(err.to_string()))?;

    let (control, controls) = mpsc::channel::<Control>();
    let thread = thread::Builder::new()
        .name("hey-listen-capture".to_string())
        .spawn(move || poll_loop(&mut stream, &controls, sink))
        .map_err(|err| CaptureError::Control(err.to_string()))?;

    Ok(CaptureHandle {
        control,
        thread: Some(thread),
        sample_rate: CAPTURE_RATE,
        channels: CAPTURE_CHANNELS,
    })
}

/// Poll loop: apply pending controls, drain chunks/events, and idle-wait otherwise.
fn poll_loop(
    stream: &mut Stream,
    controls: &Receiver<Control>,
    mut sink: impl FnMut(CaptureMessage),
) {
    loop {
        let mut stop = false;
        while let Ok(message) = controls.try_recv() {
            if apply(stream, message) {
                stop = true;
            }
        }
        if stop {
            break;
        }

        let mut idle = true;
        while let Some(chunk) = stream.poll_chunk() {
            idle = false;
            sink(CaptureMessage::Chunk(chunk.data));
        }
        while let Some(event) = stream.poll_event() {
            idle = false;
            if let Some(event) = map_event(event) {
                sink(CaptureMessage::Event(event));
            }
        }

        if idle {
            // Wait for a control message (wakes immediately) or the poll interval.
            match controls.recv_timeout(POLL_INTERVAL) {
                Ok(message) => {
                    if apply(stream, message) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                // The handle was dropped; stop the stream.
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    stream.stop();
}

/// Apply one control message; returns `true` if the loop should stop.
fn apply(stream: &Stream, message: Control) -> bool {
    match message {
        Control::Pause => {
            stream.pause();
            false
        }
        Control::Resume => {
            stream.resume();
            false
        }
        Control::SetGain(gain) => {
            let _ = stream.set_gain(gain);
            false
        }
        Control::Stop => true,
    }
}

/// Map a flexaudio event to the frontend-facing shape, dropping ones that carry no
/// user-visible signal.
fn map_event(event: FlexEvent) -> Option<CaptureEvent> {
    match event {
        FlexEvent::ChunkDropped { count } => Some(CaptureEvent {
            kind: "dropped".to_string(),
            message: Some(format!("{count} chunks dropped")),
        }),
        FlexEvent::StreamStalled => Some(CaptureEvent {
            kind: "stalled".to_string(),
            message: None,
        }),
        FlexEvent::StreamRecovered => Some(CaptureEvent {
            kind: "recovered".to_string(),
            message: None,
        }),
        FlexEvent::PermissionDenied => Some(CaptureEvent {
            kind: "permission".to_string(),
            message: None,
        }),
        FlexEvent::DeviceLost => Some(CaptureEvent {
            kind: "device-lost".to_string(),
            message: None,
        }),
        FlexEvent::Error(message) => Some(CaptureEvent {
            kind: "error".to_string(),
            message: Some(message),
        }),
        _ => None,
    }
}
