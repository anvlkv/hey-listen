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
///
/// Device enumeration talks to the OS audio stack, so it runs on the blocking pool
/// rather than the main thread (synchronous commands run on the main thread, which
/// would freeze the UI on a slow/hotplugging device).
#[tauri::command]
pub async fn list_devices() -> Result<Vec<DeviceDto>, CaptureError> {
    tauri::async_runtime::spawn_blocking(capture::list_devices)
        .await
        .map_err(|err| CaptureError::Control(err.to_string()))?
}

/// Enumerate processes that can be captured as a per-process source.
#[tauri::command]
pub async fn list_processes() -> Result<Vec<ProcessDto>, CaptureError> {
    tauri::async_runtime::spawn_blocking(capture::list_processes)
        .await
        .map_err(|err| CaptureError::Control(err.to_string()))?
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
///
/// Opening a capture session blocks (it talks to the OS backend and spawns the poll
/// thread), and stopping one **joins** that thread, so both run on the blocking pool —
/// never on the main thread, and never while holding the session lock. Synchronous
/// commands run on the main thread, where a join would freeze the whole app.
#[tauri::command]
pub async fn start_capture(
    window: WebviewWindow,
    args: StartCaptureArgs,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<CaptureInfo, CaptureError> {
    let state = window_state(&window);

    let config = CaptureConfig {
        kind: CaptureKind::parse(&args.kind)?,
        device_id: args.device_id.filter(|id| !id.is_empty()),
        mix_mic_device_id: args.mix_mic_device_id.filter(|id| !id.is_empty()),
        mix_system_device_id: args.mix_system_device_id.filter(|id| !id.is_empty()),
        target_pid: args.target_pid,
        gain: args.gain,
    };

    // Drop any previous session before starting the new one: take it out under a
    // short lock, then stop it (off the lock, off the main thread).
    let previous = state
        .capture
        .lock()
        .map_err(|err| CaptureError::Control(err.to_string()))?
        .take();
    if let Some(previous) = previous {
        stop_session(previous).await?;
    }

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
            // Only the capturing window's Source panel should show this: on a
            // `WebviewWindow`, `emit` is a global broadcast — `emit_to` is the scoped one.
            let _ = status_window.emit_to(status_window.label(), SOURCE_STATUS, event);
        }
    };

    let handle = tauri::async_runtime::spawn_blocking(move || capture::start(config, sink))
        .await
        .map_err(|err| CaptureError::Control(err.to_string()))??;

    let info = CaptureInfo {
        sample_rate: handle.sample_rate,
        channels: handle.channels,
    };
    // Install the new session; if one slipped in meanwhile, stop it off-lock.
    let displaced = state
        .capture
        .lock()
        .map_err(|err| CaptureError::Control(err.to_string()))?
        .replace(handle);
    if let Some(displaced) = displaced {
        stop_session(displaced).await?;
    }
    Ok(info)
}

/// Stop the running capture (no-op if none).
#[tauri::command]
pub async fn stop_capture(window: WebviewWindow) -> Result<(), CaptureError> {
    let state = window_state(&window);
    let handle = state
        .capture
        .lock()
        .map_err(|err| CaptureError::Control(err.to_string()))?
        .take();
    if let Some(handle) = handle {
        stop_session(handle).await?;
    }
    Ok(())
}

/// Stop a capture session off the calling thread.
///
/// [`CaptureHandle::stop`] joins the poll thread (after flexaudio tears the backend
/// down), so it must not run on the main thread or while the session lock is held.
async fn stop_session(mut handle: CaptureHandle) -> Result<(), CaptureError> {
    tauri::async_runtime::spawn_blocking(move || handle.stop())
        .await
        .map_err(|err| CaptureError::Control(err.to_string()))
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
