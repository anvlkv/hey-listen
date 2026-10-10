//! Preview playback commands (ADR-9).
//!
//! Playback lives in the core: the frontend drives it with fire-and-forget
//! commands and asks for the position while scrubbing. The filter graph (if any)
//! is applied here, so the preview matches what analysis will see from M4.

use tauri::WebviewWindow;

use crate::audio::graph;
use crate::audio::pcm;
use crate::audio::playback::{self, OutputDeviceDto, PlaybackError};
use crate::state::window_state;

/// List the audio output devices to preview through.
#[tauri::command]
pub fn list_output_devices() -> Vec<OutputDeviceDto> {
    playback::list_output_devices()
}

/// Preview `start..end` (seconds, source time). `channel` is a 0-based channel or
/// `None` to downmix; `device` selects an output device (or the default).
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
) -> Result<(), PlaybackError> {
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
        pcm::resample_linear(&mono, rate, device_rate)
    })
    .await
    .map_err(|err| PlaybackError::Control(err.to_string()))?;

    let seconds = if device_rate > 0 {
        mono.len() as f64 / f64::from(device_rate)
    } else {
        0.0
    };
    window_state(&window)
        .audio
        .playback
        .load(mono, device_rate, 0.0, seconds, loop_region);
    Ok(())
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
