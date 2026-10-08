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

## M3 — Filtering + synthesis graphs ✅

- solid-flow fundsp graph editors, as **separate Workbench tabs** (filter / synth);
  the filter graph is applied before preview and (from M4) analysis, with a
  Toolbar **bypass toggle**.
- fundsp synth source (built in the synth tab, rendered to PCM in Rust).
- Preview playback moved into the Rust core (cpal), with the PCM owned by the core
  — see ADR-9. Output **gain + device** are Toolbar controls.

> The graph editor's *editing* lives in the frontend (`solid-flow`); the *net*
> is compiled in Rust (`audio/graph.rs`). The frontend retains a PCM copy only for
> the Timeline waveform — a transitional duplication, see ADR-9.

## M4 — Analysis engine + first tools ✅

- oxiaudio wrappers; `run_analysis` command; shared FFT params.
- First tools: waveform, spectrum/FFT, spectrogram.

> Delivered: `audio/analysis.rs` (tool implementations + shared conditioning),
> the single `run_analysis` command, and the shared params store
> (`state/analysis.ts`). Analyzer tabs (waveform / spectrum / spectrogram) are
> Workbench tabs with params + about popovers, listed in the Sidebar under
> **Analyzers**; the shared runner (`state/analyzer.ts`) debounces auto-run and
> keeps results latest-wins. Progress streaming and core-side cancellation are
> deferred to the expensive tools in M5.

## M5 — Full tool inventory + tabs

- All analysis tools (see [`analysis-tools.md`](analysis-tools.md)); params +
  about popovers; no-duplicate-tabs rule; cross-tab zoom/cursor sync.
- swap the order of graphs and analyzers (analyzers come first)
- searchbox at the top filters available analyzers by title and keywords

## M6 — Project file

- Binary project file read/write (see
  [`project-file-format.md`](project-file-format.md)); streaming `DATA` for
  large audio.

## M7 — Multi-window + polish + packaging

- N independent project windows; 
- Popout any tab in a separate window. Title reflects the tab name and source. Selecting the tab in main window should focus the secondary window.
- bundle; github workflows for releases; platform matrix.
- all pure numeric inputs should be refactored to allow dragging (up high, down low, no slider just a visual hint) as well as typing

## Backlog (post-M4 polish)

- **Full fundsp node coverage.** The graph-editor palette is a focused subset today; expand it to all of fundsp — every filter family and their control-input variants, dynamics, panning/stereo, modulation, reverbs, the sequencer, and custom nodes — with per-node inspectors/presets. See [`graph-editor.md`](graph-editor.md) → Planned. Add search box for filtering available nodes. Make input/output nodes undeletable, automove them to left and right edges of the flowchart. Add hints describing what each filter/node does (search the web for precise description, not fundsp specific).
- **Timeline filtered overlay.** Draw the filtered signal over the raw waveform so the filter's effect is visible (and mark when the filter is active/bypassed). See [`ui-layout.md`](ui-layout.md).
- **Stereo graphs** (the compiled net is mono today) and parameter smoothing for live edits.
- **Timeline window drag.** Move the whole analysis window (keeping its width) via
  a handle at its top, alongside the existing start/end handles.
- **Axis label readability.** Un-truncate chart axis labels (and the Timeline
  ruler): wider margins, smarter tick formatting / units, or rotation.
- **UI font scale.** A user-adjustable font size / UI zoom for the whole interface.
- **Light / dark theme.** An **auto / dark / light** setting that themes the UI
  *and* the charts (uPlot strokes/axes, the spectrogram background + colormap, and
  the dockview theme).
- **Explanatory tooltips** on choices — when to use which window function,
  hop/overlap, FFT size, and which analyzer tool.
- **Spectrum layers.** Add **min / max / mean** magnitude layers to the spectrum
  chart (toggle each), instead of only the averaged spectrum.
