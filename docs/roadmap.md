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

## M5 — Full tool inventory + tabs ✅

- All analysis tools (see [`analysis-tools.md`](analysis-tools.md)); params +
  about popovers; no-duplicate-tabs rule; cross-tab zoom/cursor sync.
- swap the order of graphs and analyzers (analyzers come first)
- searchbox at the top filters available analyzers by title and keywords

> Delivered: every tool in [`analysis-tools.md`](analysis-tools.md) — the M4 trio
> (waveform / spectrum / spectrogram) plus level meters, mel spectrogram, MFCC,
> chromagram, the seven spectral-shape features, spectral contrast, harmonic ratio,
> ZCR, three pitch detectors, tempo, onsets, downbeats, and the three loudness
> tools. `audio/analysis.rs` dispatches them all through the one `run_analysis`
> command; a per-tool `ToolOptions` carries tool-specific params (band counts, YIN
> threshold, f0 range, bar length, momentary window). The frontend registry
> (`state/analyzer.ts`) drives a generic view layer
> (`components/analyzer/AnalyzerView.tsx` → series / matrix / readouts / events),
> so a tool is a registry entry, not a new component. The Sidebar now has a search
> box (title + keywords) and lists **analyzers first**, grouped by domain, then the
> graph editors. Charts share one solid-uplot plugin bus (`state/chartSync.ts`):
> cursor and x-zoom are synced across tabs (time and frequency groups), including
> the canvas spectrogram/matrix views.

## M6 — Project file ✅

- Binary project file read/write (see
  [`project-file-format.md`](project-file-format.md)); streaming `DATA` for
  large audio.

> Delivered: `project/` (`mod`, `error`, `sections`, `read`, `write`) implements the
> versioned container — header, section index, `META`/`SOURCE`/`DATA`/`SETUP`/
> `LAYOUT`/`RESULTS`, and a trailing CRC-32. `DATA` is a self-describing chunked
> interleaved-`f32` blob with a trailing chunk index + footer, so audio streams in
> (and can be seeked) chunk-by-chunk. Commands `save_project` / `load_project` (plus
> native open/save dialogs) bridge it: the core writes its owned PCM (ADR-9) as
> `DATA` and streams it back on load. The Toolbar shows only the current project
> name; the file actions live in a native **application menu** (File / Edit / View /
> Window / Help) — **File → Open Recent** keeps the last 10 files (persisted under
> the app config dir), the other File actions are emitted to the frontend on
> `app:menu`, and the rest are native. The window **title** shows the project file
> name on open/save. `.heyl` files are **associated** with the app, so a
> double-clicked project opens it (macOS `RunEvent::Opened` / command line, drained
> via `take_pending_open_paths`). `state/project.ts` collects the descriptor + setup +
> layout and restores every store and the Workbench (dockview) layout on load.
> Result caching is deferred — `RESULTS` is written empty and the analyzers
> re-derive on load — as is `i16`/FLAC `DATA` (the core owns `f32` and always
> writes `format = 0`). See [`project-file-format.md`](project-file-format.md) →
> Implemented / Deferred.

## M7 — Multi-window + polish + packaging

- N independent project windows; 
- Popout any tab in a separate window. Title reflects the tab name and source. Selecting the tab in main window should focus the secondary window.
- bundle; github workflows for releases; platform matrix.
- all pure numeric inputs should be refactored to allow dragging (up high, down low, no slider just a visual hint) as well as typing
- Toolbar polish: drop the temporary `Rust backend:` debug status (the M0 ping
  scaffold) and add a preview **output meter** beside the output gain/device.
- chart readout bar shouldn't change height. reserve enough space for each entry upfront
- hide or better swap timeline and sources panel. add button to replace source.

## M8 — E2E test suite

- WebdriverIO + `@wdio/tauri-service` driving the built app through the system
  WebView, with the **embedded** driver (`tauri-plugin-wdio-webdriver`) — the only
  macOS route that needs no external driver or API key — and `@wdio/tauri-plugin`
  for `browser.tauri.execute()` / IPC mocking.
- Deterministic fixtures (a generated 440 Hz WAV, a chirp/noise WAV, a known synth
  graph) so every run is reproducible.
- Stable `data-testid`/ARIA selectors added only where a test needs one.
- A test matrix (see [`testing.md`](testing.md)) covering **every analyzer tool**
  (one parametrized smoke test), **both graph editors**, **all source kinds**, and
  the cross-cutting scenarios (search, no-duplicate tabs, shared-param sync,
  zoom/cursor sync, filter bypass, error/warning surfacing, timeline window +
  channel select, project save/load, tab popout). A handful of correctness
  spot-checks on the known
  fixture is the only numeric coverage — no per-tool regression suites.
- GitHub Actions CI on the platform matrix (macOS / Linux / Windows); capture is
  covered by an automated error-path test, the granted happy path a manual smoke
  (TCC prompts need a signed bundle).

> Depends on M6 (project save/load) and M7 (popout) for the persistence and
> multi-window scenarios; everything else can be exercised from M5.

## M9 — MCP server (agent access + UI following)

- A **Model Context Protocol (MCP)** server that exposes Hey Listen as tools an AI
  agent can drive: open a source, run every analysis tool, edit the filter/synth
  graphs, preview playback, and save/load projects — the same surface the UI
  drives, not a parallel one.
- **UI following** — agent actions are reflected in the live window and vice
  versa: open/focus Workbench tabs, observe the selected source and analysis
  window, and read the dockview layout, so an agent follows (and steers) the
  user's single-window project instead of running headless.

> Reuses the Rust core (`audio/*`, `commands/*`); UI following rides the Tauri IPC
> boundary so the agent and the user share one project per window.

## Backlog

- **Undo / redo.** The app keeps no edit history (there is no Edit menu). Adding
  undo/redo means an app-level history (graph edits, layout/tab changes, shared
  params, tool options, timeline window) plus its menu items (`CmdOrCtrl+Z` /
  `Shift+CmdOrCtrl+Z`).
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
- **Drag&Drop file** Add input file by dragging into window.
- **Prevent work loss** When one source exists prompt the user before replacing. Inform the user about unsaved work (title `*`, prompt)
- **Reframing from charts** let the user select new timeline start/end on charts, right mouse button menu. disable default menus
- **Shared params** move the shared params to the main toolbar
