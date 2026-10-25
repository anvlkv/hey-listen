# Source model

Every project is built around **one audio source**. Changing the source replaces
the entire timeline (and thus the project's contents). Each window hosts one
project (the app can run several — see [`ui-layout.md`](ui-layout.md) → Windows).
An audio file can also be opened by **dragging it onto the window**; the Timeline's
**Replace** button (an icon, with a tooltip) reveals the Source panel again once a
source exists.
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
| **Synth** | fundsp graph (built in the **Synth graph** Workbench tab) | rendered to PCM in Rust; becomes the timeline source; **Live** re-renders it in place (M22, planned) |

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
  **application** (process); a `Mix` picks a mic device and a system device. The
  device and application lists are enumerated **when the kind is picked**, not at
  launch (see *OS permissions* below) — as is the preview **output** device list.
- **Gain** applies live; **pause/resume** stop and restart chunk delivery without
  tearing down the stream.

## Timeline behavior (all sources)

- Shows the whole recording plus the **analysis window** (`start..end`).
- For extra-short windows the timeline **zooms in** on the window.
- **Zoom / pan** — the wheel zooms around the cursor (M23 changes this to a
  trackpad-stable gesture: scroll pans, pinch / `⌘`/Ctrl+wheel zooms), dragging the
  waveform pans, and the toolbar's zoom buttons fit / zoom-to-window. When the view is
  narrower than the source a **horizontal scrollbar** appears along the bottom of the
  region (a whole-file overview whose thumb *is* the visible span); drag its thumb to pan,
  click the track to jump, or use the arrow keys. See `lib/timelineScroll.ts`.
- The **filtered** signal (when a filter is active) is drawn as a translucent **overlay**
  over the raw waveform, so its effect reads as a tint on the signal rather than a
  replacement for it.
- Repaints are cheap at **every** zoom: the waveform is drawn from a pyramid of min/max
  envelopes (one pass per source), so a zoomed-in long recording never rescans its PCM
  on a pointer move or a transport tick (`lib/waveform.ts`).
- Dragging `start` or `end` plays back a **preview** of that region.
- The whole window can be **dragged** (keeping its width) via a handle at its top; a
  preview that is playing reloads onto the new window when the drag settles, so it never
  keeps auditioning the old region.
- The bottom **note lane** holds the project's annotations (M14) — see
  [`notes.md`](notes.md) → Surfacing.
- For a **multichannel** source, a channel selector (in the Timeline toolbar) picks
  the channel to display/analyse, or downmixes to mono. It is the shared analysis
  param, so the waveform, preview playback and (M4+) analyzers all agree.

### Planned — transport and framing (M23)

- A committed reframe (annotation **Analyze**, a chart's **Reframe** menu, a
  **`Shift`+drag** window selection) **frames the analysis window in the viewport** and
  focuses the Timeline; selecting an annotation still never moves the window (ADR-19).
- The transport becomes **play/pause** with a seekable playhead that persists when paused
  or stopped; the ruler seeks, loop is a toggle, and the view can follow the playhead.
- **Wheel/trackpad** handling is normalized and gesture-based: scroll pans (time, plus
  frequency on 2-D views), pinch / `⌘`/Ctrl+wheel zooms at the cursor, and a horizontal
  gesture never zooms. No vertical waveform zoom. See `lib/wheelGesture.ts` (planned).
- Annotation ranges and live lane selections draw **full-height vertical rules** at their
  edges in addition to the lane handles. See [`roadmap.md`](roadmap.md) → M23.

For the synth's planned live mode (audition loop + in-place source rewrite) see
[`roadmap.md`](roadmap.md) → M22 and ADR-21.

## OS permissions (macOS)

Shipped in `src-tauri/Info.plist`, which Tauri merges into the bundle's
`Info.plist` automatically — a `Info.plist` next to `tauri.conf.json` is
auto-detected, so no config key is needed (and it works on older CLIs too). macOS
only shows the TCC prompt for a **bundled / signed** app, so capture permissions
must be tested against a packaged build.

- `NSMicrophoneUsageDescription` for mic capture.
- `NSAudioCaptureUsageDescription` (+ TCC `kTCCServiceAudioCapture`) for system /
  process capture (process taps need macOS 14.4+).

The prompt is raised **only when the audio stack is actually used**, never at launch.
That turned out to need *two* deferrals, not one:

- **Capture devices.** `flexaudio`'s enumeration scans cpal's *input* devices, which is
  itself a microphone access on macOS, so `initCapture()` does not enumerate. The Source
  panel requests the list (`list_devices`) when the user picks a live kind (**Mic** /
  **System** / **Mix**), and the monitoring capture session opens at that same moment.
  The **Application** kind lists processes on its own first selection — read-only, and
  (per `flexaudio`) not something that triggers a prompt.
- **Output devices.** Listing them is *also* an audio-stack access: cpal's
  `output_devices()` filters with `supports_output()`, which calls
  `supported_output_configs()` and therefore **instantiates a HAL AudioUnit per device**
  to read its buffer-frame-size range. That makes `coreaudiod` preflight
  `kTCCServiceAudioCapture` and then raise the **microphone** prompt (observed in the
  `tccd` log a couple of seconds into launch). So the toolbar's output-device list is
  fetched when its picker is **opened** (`Combobox.onOpen`), not in `onMount`.

A file or synth project therefore never asks for the microphone, and an app launch
never touches the audio stack at all. To verify a change here, watch `tccd` rather than
the UI: `log stream --predicate 'process == "tccd"'` shows the `AUTHREQ_PROMPTING` line
(and its `service=`), which is the ground truth for *what* was requested.

Without the grant, a blocked capture surfaces as an **error**, not as silence — but
`flexaudio` 0.5 asks for consent itself instead of leaving it to the backend's error
text. At `start`, a `NotDetermined` status raises the OS prompt, and `Denied` /
`Restricted` returns `Error::PermissionDenied { permission, detail }`; a revocation
*after* startup arrives as a `PermissionDenied` **event**. The app maps both onto its
existing `source_status` kinds — `permission` (the crate's own explanation becomes the
banner text) and `recovered` (a late `PermissionGranted` clears it). The advisory
`PermissionPending` (consent still undecided; capture continues) is deliberately not
surfaced, and `Permission::guidance()` — the per-platform fix, e.g. "Allow access in
macOS System Settings > Privacy & Security > Microphone …" — is available but not wired
into the UI yet.

You can check the engine directly with `cargo run --example capture_probe` (from
`src-tauri/`), which prints the peak of a short mic + system capture. Reset and retry
with `tccutil reset Microphone com.anvlkv.heylisten` and
`tccutil reset AudioCapture com.anvlkv.heylisten`.
