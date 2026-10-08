# Roadmap

## M0 — Shell ✅

- Tauri 2 + SolidJS scaffold, identifier `com.anvlkv.heylisten`.
- Dependencies wired (frontend + Rust audio crates).
- Fixed-region layout + dockview (Workbench tabs only) + IPC ping.
- Builds and launches. ✅

## M1 — File source + timeline ✅

- symphonia probe + decode; waveform rendering in the Timeline.
- Analysis window (start/end) + zoom + drag preview.

## M2 — Live capture ✅

- Input source picker (file / mic / system / process / mix) lives in the
  **bottom-left** corner — the intersection of the Sidebar and Timeline regions.
- flexaudio sources (mic/system/process/mix); device/process enumeration
  (comboboxes).
- Growing timeline; start timer + target duration; gain/pause/resume + input meter.
- macOS capture permissions (microphone + system/process audio) via a merged
  `Info.plist`.

## M3 — Filtering + synthesis graphs

- solid-flow fundsp graph editor; apply graph before analysis.
- fundsp synth source (build in solid-flow, render to PCM).
- Move preview playback into the Rust core (cpal), with the PCM owned by the core
  — see ADR-9.

## M4 — Analysis engine + first tools

- oxiaudio wrappers; `run_analysis` command; shared FFT params.
- First tools: waveform, spectrum/FFT, spectrogram.

## M5 — Full tool inventory + tabs

- All analysis tools (see [`analysis-tools.md`](analysis-tools.md)); params +
  about popovers; no-duplicate-tabs rule; cross-tab zoom/cursor sync.

## M6 — Project file

- Binary project file read/write (see
  [`project-file-format.md`](project-file-format.md)); streaming `DATA` for
  large audio.

## M7 — Multi-window + polish + packaging

- N independent project windows; bundle/icons.
