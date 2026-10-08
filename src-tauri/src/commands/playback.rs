//! Preview playback commands (ADR-9).
//!
//! Playback lives in the core: the frontend drives it with fire-and-forget
//! commands and asks for the position while scrubbing. The filter graph (if any)
//! is applied here, so the preview matches what analysis will see from M4.

use tauri::{AppHandle, Manager};

use crate::audio::graph;
use crate::audio::pcm;
use crate::audio::playback::{self, OutputDeviceDto, PlaybackError};
use crate::state::AudioState;

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
    app: AppHandle,
    start: f64,
    end: f64,
    loop_region: bool,
    channel: Option<usize>,
    device: Option<String>,
) -> Result<(), PlaybackError> {
    let (region, rate, channels, filter, device_rate) = {
        let state = app.state::<AudioState>();
        let device_rate = state.playback.ensure_started(device)?;

        let guard = state
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
                    eprintln!("hey-listen: filter graph failed to apply, previewing raw: {err}");
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
    app.state::<AudioState>()
        .playback
        .load(mono, device_rate, 0.0, seconds, loop_region);
    Ok(())
}

/// Stop any in-flight preview.
#[tauri::command]
pub fn stop_preview(app: AppHandle) {
    app.state::<AudioState>().playback.stop();
}

/// Set the preview output gain (linear, finite and ≥ 0).
#[tauri::command]
pub fn set_output_gain(app: AppHandle, gain: f32) {
    app.state::<AudioState>().playback.set_gain(gain);
}

/// Current preview position in source seconds, or `None` when not playing.
#[tauri::command]
pub fn preview_position(app: AppHandle) -> Option<f64> {
    app.state::<AudioState>().playback.position()
}
