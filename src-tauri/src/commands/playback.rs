//! Preview playback commands (ADR-9).
//!
//! Playback lives in the core: the frontend drives it with fire-and-forget
//! commands and asks for the position while scrubbing. The filter graph (if any)
//! is applied here, so the preview matches what analysis will see from M4.
//!
//! **Varispeed.** `preview_region` takes a `speed` (M14 follow-up). It is a *preview*
//! control only — analysis always reads the source at 1× — and it is implemented by
//! resampling the loaded region, so it shifts pitch like a tape machine rather than
//! time-stretching.

use tauri::WebviewWindow;

use crate::audio::graph;
use crate::audio::pcm;
use crate::audio::playback::{self, OutputDeviceDto, PlaybackError};
use crate::state::window_state;

/// The slowest / fastest preview speed `preview_region` will honour.
pub const MIN_SPEED: f64 = 0.25;
pub const MAX_SPEED: f64 = 4.0;

/// List the audio output devices to preview through.
///
/// Enumerating output devices queries the OS audio stack, so it runs on the blocking
/// pool rather than the main thread (synchronous commands run on the main thread).
#[tauri::command]
pub async fn list_output_devices() -> Vec<OutputDeviceDto> {
    tauri::async_runtime::spawn_blocking(playback::list_output_devices)
        .await
        .unwrap_or_default()
}

/// Preview `start..end` (seconds, source time). `channel` is a 0-based channel or
/// `None` to downmix; `device` selects an output device (or the default); `speed` is the
/// playback rate (varispeed, default/nonsense = 1×, clamped to
/// [`MIN_SPEED`]..[`MAX_SPEED`]).
///
/// The region is mixed down, filtered by the project graph, resampled to the
/// device rate, and looped by the core.
#[tauri::command]
pub async fn preview_region(
    window: WebviewWindow,
    start: f64,
    end: f64,
    loop_region: bool,
    channel: Option<usize>,
    device: Option<String>,
    speed: Option<f64>,
) -> Result<(), PlaybackError> {
    let speed = clamp_speed(speed);
    let (region, rate, channels, filter, device_rate) = {
        let state = window_state(&window);
        let device_rate = state.audio.playback.ensure_started(device)?;

        let guard = state
            .audio
            .source
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let source = guard.as_ref().ok_or(PlaybackError::NoSource)?;
        let channels = source.channels.max(1) as usize;
        let frames = source.samples.len() / channels;
        let source_rate = source.sample_rate.max(1);

        let first = ((start.max(0.0) * f64::from(source_rate)).floor() as usize).min(frames);
        let last = ((end.max(0.0) * f64::from(source_rate)).ceil() as usize)
            .min(frames)
            .max(first);
        let region = source.samples[first * channels..last * channels].to_vec();

        let filter = state
            .audio
            .filter
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone();

        (region, source_rate, channels, filter, device_rate)
    };

    // The buffer is always *drained* at the device rate, so the speed is baked in by
    // resampling the region instead: a `speed`× faster tape means a `1/speed`× shorter
    // buffer. `logical_rate` is the frame rate the core reports positions against — with
    // it, `position()` still yields **source** seconds (speed × elapsed real time).
    let logical_rate = logical_rate(device_rate, speed);

    let mono = tauri::async_runtime::spawn_blocking(move || {
        let mono = pcm::mixdown(&region, channels, channel);
        let mono = match filter {
            Some(spec) => match graph::apply_mono(&spec, &mono, rate) {
                Ok(filtered) => filtered,
                Err(err) => {
                    // Should not happen: the graph is validated when installed.
                    log::error!("filter graph failed to apply, previewing raw: {err}");
                    mono
                }
            },
            None => mono,
        };
        pcm::resample_linear(&mono, rate, logical_rate)
    })
    .await
    .map_err(|err| PlaybackError::Control(err.to_string()))?;

    let seconds = if logical_rate > 0 {
        mono.len() as f64 / f64::from(logical_rate)
    } else {
        0.0
    };
    window_state(&window)
        .audio
        .playback
        .load(mono, logical_rate, 0.0, seconds, loop_region);
    Ok(())
}

/// Clamp a requested preview speed, treating a missing / invalid value as 1×.
fn clamp_speed(speed: Option<f64>) -> f64 {
    match speed {
        Some(value) if value.is_finite() => value.clamp(MIN_SPEED, MAX_SPEED),
        _ => 1.0,
    }
}

/// The rate a `speed`× region is reported against once the device drains it at `1×`.
fn logical_rate(device_rate: u32, speed: f64) -> u32 {
    if device_rate == 0 {
        return 0;
    }
    (f64::from(device_rate) / speed).round().max(1.0) as u32
}

/// Stop any in-flight preview.
#[tauri::command]
pub fn stop_preview(window: WebviewWindow) {
    window_state(&window).audio.playback.stop();
}

/// Set the preview output gain (linear, finite and ≥ 0).
#[tauri::command]
pub fn set_output_gain(window: WebviewWindow, gain: f32) {
    window_state(&window).audio.playback.set_gain(gain);
}

/// Current preview position in source seconds, or `None` when not playing.
#[tauri::command]
pub fn preview_position(window: WebviewWindow) -> Option<f64> {
    window_state(&window).audio.playback.position()
}

/// Peak magnitude (0..) of the current preview output, for the output meter.
#[tauri::command]
pub fn output_level(window: WebviewWindow) -> f32 {
    window_state(&window).audio.playback.level()
}
