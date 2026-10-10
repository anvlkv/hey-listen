# Source model

Every project is built around **one audio source**. Changing the source replaces
the entire timeline (and thus the project's contents). Each window hosts one
project (the app can run several — see [`ui-layout.md`](ui-layout.md) → Windows).
An audio file can also be opened by **dragging it onto the window**; the Timeline's
**Replace…** button reveals the Source panel again once a source exists.
Replacing an existing source is **confirmed first**, and unsaved work is tracked
(a `*` in the project name/title) with a prompt on close / New / Open.

## Source kinds

| Kind | Backend | Timeline |
| --- | --- | --- |
| **File** | symphonia (demux + decode) | static — full length known up front |
| **Input: Mic** | flexaudio `SourceKind::Mic` | grows while recording |
| **Input: System loopback** | flexaudio `SourceKind::SystemLoopback` | grows while recording |
| **Input: Process loopback** | flexaudio `SourceKind::ProcessLoopback` + `target_pid` | grows while recording |
| **Input: Mix** | flexaudio `SourceKind::Mix` (mic + system) | grows while recording |
| **Synth** | fundsp graph (built in the **Synth graph** Workbench tab) | rendered to PCM in Rust; becomes the timeline source |

## Recordable inputs

For `Mic` / `SystemLoopback` / `ProcessLoopback` / `Mix`:

- The user can set a **start timer** (delay before recording) and a **target
  duration** (auto-stop).
- The timeline **grows** as audio is recorded; the window/view auto-follow the end
  until the user zooms or drags.
- Capture is a flexaudio `Stream` polled on a background thread; 20 ms chunks
  stream to the frontend via a `Channel` and are appended to the timeline.
- Capture is normalized to **48 kHz stereo** (flexaudio's canonical pass-through).
- Selecting a live kind **opens a capture session immediately** (monitoring), so
  the input meter shows level while idle; **Record** reuses that session and
  starts appending to the timeline (only the audio after Record is kept), and
  stopping a recording leaves the session open so the meter stays live.
- Where the kind allows it, the user picks a **device** (mic / system) or
  **application** (process); a `Mix` picks a mic device and a system device.
- **Gain** applies live; **pause/resume** stop and restart chunk delivery without
  tearing down the stream.

## Timeline behavior (all sources)

- Shows the whole recording plus the **analysis window** (`start..end`).
- For extra-short windows the timeline **zooms in** on the window.
- Dragging `start` or `end` plays back a **preview** of that region.
- The whole window can be **dragged** (keeping its width) via a handle at its top.
- For a **multichannel** source, a channel selector (in the Timeline toolbar) picks
  the channel to display/analyse, or downmixes to mono. It is the shared analysis
  param, so the waveform, preview playback and (M4+) analyzers all agree.

## OS permissions (macOS)

Shipped in `src-tauri/Info.plist`, which Tauri merges into the bundle's
`Info.plist` automatically — a `Info.plist` next to `tauri.conf.json` is
auto-detected, so no config key is needed (and it works on older CLIs too). macOS
only shows the TCC prompt for a **bundled / signed** app, so capture permissions
must be tested against a packaged build.

- `NSMicrophoneUsageDescription` for mic capture.
- `NSAudioCaptureUsageDescription` (+ TCC `kTCCServiceAudioCapture`) for system /
  process capture (process taps need macOS 14.4+).

Without the grant, flexaudio fails at `start`: microphone capture reports
`device not found` (cpal maps the denial that way) and system/process capture
reports `AudioHardwareCreateProcessTap returned null tap id`. A blocked capture
therefore surfaces as an **error**, not as silence. You can check the engine
directly with `cargo run --example capture_probe` (from `src-tauri/`), which
prints the peak of a short mic + system capture. Reset and retry with
`tccutil reset Microphone com.anvlkv.heylisten` and
`tccutil reset AudioCapture com.anvlkv.heylisten`.
