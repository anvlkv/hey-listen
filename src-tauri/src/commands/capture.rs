//! Live-capture commands (flexaudio) — see `docs/source-model.md`.
//!
//! Thin adapters over [`crate::audio::capture`]: they own the IPC boundary
//! (argument/return types, `Channel`, `State`) but keep the audio work in the
//! engine. One window = one project = one source, so each window holds its own
//! session in its [`crate::state::WindowState`].

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Emitter, WebviewWindow};

use crate::audio::capture::{
    self, CaptureConfig, CaptureError, CaptureHandle, CaptureKind, CaptureMessage, DeviceDto,
    ProcessDto,
};
use crate::commands::stream;
use crate::state::{window_state, WindowState};

/// Event name for capture status changes (device lost, permission, stall, …).
const SOURCE_STATUS: &str = "source_status";

/// Enumerate microphones and system-output (loopback) devices.
#[tauri::command]
pub fn list_devices() -> Result<Vec<DeviceDto>, CaptureError> {
    capture::list_devices()
}

/// Enumerate processes that can be captured as a per-process source.
#[tauri::command]
pub fn list_processes() -> Result<Vec<ProcessDto>, CaptureError> {
    capture::list_processes()
}

/// Arguments for [`start_capture`] (camelCase keys from the frontend).
#[derive(serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StartCaptureArgs {
    /// `mic` | `system` | `process` | `mix`.
    pub kind: String,
    pub device_id: Option<String>,
    pub mix_mic_device_id: Option<String>,
    pub mix_system_device_id: Option<String>,
    pub target_pid: Option<u32>,
    #[serde(default = "default_gain")]
    pub gain: f32,
}

fn default_gain() -> f32 {
    1.0
}

/// Capture format returned once a session starts.
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CaptureInfo {
    pub sample_rate: u32,
    pub channels: u16,
}

/// Start a live capture, streaming 20 ms `f32` chunks over `on_chunk`. Replaces any
/// existing capture (the whole timeline changes when the source changes).
#[tauri::command]
pub fn start_capture(
    window: WebviewWindow,
    args: StartCaptureArgs,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<CaptureInfo, CaptureError> {
    let state = window_state(&window);
    // Drop any previous session before starting the new one.
    if let Some(mut previous) = state
        .capture
        .lock()
        .map_err(|err| CaptureError::Control(err.to_string()))?
        .take()
    {
        previous.stop();
    }

    let config = CaptureConfig {
        kind: CaptureKind::parse(&args.kind)?,
        device_id: args.device_id.filter(|id| !id.is_empty()),
        mix_mic_device_id: args.mix_mic_device_id.filter(|id| !id.is_empty()),
        mix_system_device_id: args.mix_system_device_id.filter(|id| !id.is_empty()),
        target_pid: args.target_pid,
        gain: args.gain,
    };

    // Route status events back to the window that owns the capture.
    let status_window = window.clone();
    let recording_sink = state.audio.recording_sink();
    let sink = move |message: CaptureMessage| match message {
        CaptureMessage::Chunk(samples) => {
            // Keep the core's copy in sync so preview playback can use it (ADR-9).
            recording_sink.append(&samples);
            let _ = stream::send_f32_chunk(&on_chunk, &samples);
        }
        CaptureMessage::Event(event) => {
            let _ = status_window.emit(SOURCE_STATUS, event);
        }
    };

    let handle = capture::start(config, sink)?;
    let info = CaptureInfo {
        sample_rate: handle.sample_rate,
        channels: handle.channels,
    };
    *state
        .capture
        .lock()
        .map_err(|err| CaptureError::Control(err.to_string()))? = Some(handle);
    Ok(info)
}

/// Stop the running capture (no-op if none).
#[tauri::command]
pub fn stop_capture(window: WebviewWindow) -> Result<(), CaptureError> {
    let state = window_state(&window);
    if let Some(mut handle) = state
        .capture
        .lock()
        .map_err(|err| CaptureError::Control(err.to_string()))?
        .take()
    {
        handle.stop();
    }
    Ok(())
}

/// Pause chunk delivery (capture keeps running for a fast resume).
#[tauri::command]
pub fn pause_capture(window: WebviewWindow) -> Result<(), CaptureError> {
    with_session(&window_state(&window), CaptureHandle::pause)
}

/// Resume chunk delivery after a pause.
#[tauri::command]
pub fn resume_capture(window: WebviewWindow) -> Result<(), CaptureError> {
    with_session(&window_state(&window), CaptureHandle::resume)
}

/// Set the live input gain (linear, finite and ≥ 0).
#[tauri::command]
pub fn set_capture_gain(window: WebviewWindow, gain: f32) -> Result<(), CaptureError> {
    with_session(&window_state(&window), |handle| handle.set_gain(gain))
}

fn with_session(
    state: &WindowState,
    action: impl FnOnce(&CaptureHandle) -> Result<(), CaptureError>,
) -> Result<(), CaptureError> {
    let guard = state
        .capture
        .lock()
        .map_err(|err| CaptureError::Control(err.to_string()))?;
    match guard.as_ref() {
        Some(handle) => action(handle),
        None => Err(CaptureError::NotRunning),
    }
}
