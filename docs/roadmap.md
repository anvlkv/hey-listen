# Roadmap

## M0 — Shell ✅

- Tauri 2 + SolidJS scaffold, identifier `com.anvlkv.heylisten`.
- Dependencies wired (frontend + Rust audio crates).
- Fixed-region layout + dockview (Workbench tabs only) + IPC ping.
- Builds and launches. ✅

## M1 — File source + timeline ✅

- symphonia probe + decode; waveform rendering in the Timeline.
- Analysis window (start/end) + zoom + drag preview.

## M2 — Live capture (current)

- flexaudio sources (mic/system/process/mix); device/process enumeration.
- Growing timeline; start timer + target duration; gain/pause/resume.

## M3 — Filtering + synthesis graphs

- solid-flow fundsp graph editor; apply graph before analysis.
- fundsp synth source (build in solid-flow, render to PCM).

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

- N independent project windows; macOS capture permissions; bundle/icons.
