# Source model

Every project is built around **one audio source**. Changing the source replaces
the entire timeline (and thus the project's contents). Each window hosts one
project.

## Source kinds

| Kind | Backend | Timeline |
| --- | --- | --- |
| **File** | symphonia (demux + decode) | static — full length known up front |
| **Input: Mic** | flexaudio `SourceKind::Mic` | grows while recording |
| **Input: System loopback** | flexaudio `SourceKind::SystemLoopback` | grows while recording |
| **Input: Process loopback** | flexaudio `SourceKind::ProcessLoopback` + `target_pid` | grows while recording |
| **Input: Mix** | flexaudio `SourceKind::Mix` (mic + system) | grows while recording |
| **Synth** | fundsp graph (built in solid-flow) | rendered (static) or generated on demand |

## Recordable inputs

For `Mic` / `SystemLoopback` / `ProcessLoopback` / `Mix`:

- The user can set a **start timer** and a **target duration**.
- The timeline **grows** as audio is recorded.
- Capture is a flexaudio `Stream` polled on a background thread; 20 ms chunks
  stream to the frontend via a `Channel` and are appended to the timeline.

## Timeline behavior (all sources)

- Shows the whole recording plus the **analysis window** (`start..end`).
- For extra-short windows the timeline **zooms in** on the window.
- Dragging `start` or `end` plays back a **preview** of that region.

## OS permissions (macOS)

- `NSMicrophoneUsageDescription` for mic capture.
- `NSAudioCaptureUsageDescription` + TCC `kTCCServiceAudioCapture` for system /
  process capture (process taps need macOS 14.4+).
