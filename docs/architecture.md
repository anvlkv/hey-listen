# Architecture

## Two processes, one IPC boundary

Hey Listen is a Tauri 2 app: a **Rust core process** and a **SolidJS frontend**
running in the system WebView. They communicate only through the Tauri IPC
boundary (commands, events, channels), gated by capabilities.

```
┌──────────────────────────────┐        ┌────────────────────────────────┐
│ Rust core (full OS access)   │        │ WebView frontend (SolidJS)     │
│                              │        │                                │
│  flexaudio  capture engine   │        │  Timeline / Sidebar regions    │
│  symphonia  file decoder     │◄─────► │  dockview (Workbench tabs)      │
│  fundsp     filter/synth     │  IPC   │  solid-flow (graph editor)     │
│  oxiaudio   analysis         │        │  solid-uplot (charts)          │
│  project store (binary)      │        │  app state (Solid stores)      │
└──────────────────────────────┘        └────────────────────────────────┘
```

- The Rust core owns all audio I/O, decoding, analysis, and the project file.
- The frontend owns layout, tool/tab management, graph editing, and charts.
- Audio PCM crosses the boundary **only** through ordered `tauri::ipc::Channel`
  streams (not events); results and commands are JSON over `invoke`.

## Rust module layout

Existing modules are marked ✅; the rest are the target structure.

```
src-tauri/src/
├── main.rs          # desktop entry (calls lib::run)            ✅
├── lib.rs           # Builder setup, state, handler registration ✅
├── commands/        # #[tauri::command] surface, grouped by domain
│   ├── mod.rs       # ✅
│   ├── source.rs    # enumerate devices/processes, open/close sources ✅ (pick_audio_file, clear/begin/end capture source)
│   ├── decode.rs    # open file, decode range / stream          ✅ (probe_file, stream_file)
│   ├── capture.rs   # start/stop/gain/pause recording           ✅
│   ├── graph.rs     # filter/synth graph commands               ✅ (set_filter_graph, render_synth)
│   ├── playback.rs  # preview playback (cpal)                   ✅
│   ├── analysis.rs  # run analysis over a window                ✅ (run_analysis)
│   └── project.rs   # save/load binary project file               ✅ (M6: save/load_project, pick_project_*_path)
├── audio/           # engines (not commands)
│   ├── mod.rs       # ✅
│   ├── decode.rs    # symphonia demux/decode -> PCM            ✅
│   ├── capture.rs   # flexaudio Stream poll loop -> ring buffer ✅
│   ├── graph.rs     # fundsp Net: compile (push + connect) / apply / render ✅
│   ├── pcm.rs       # channel mixdown + linear resample        ✅
│   ├── playback.rs  # cpal output stream + ring buffer         ✅
│   └── analysis.rs  # oxiaudio wrappers                         ✅
├── menu.rs          # native menu (File/Edit/View/Window/Help) ✅ (M6: File → frontend; Edit → undo/redo)
├── recent.rs        # recent project files (app config dir)    ✅ (M6: backs Open Recent)
├── state.rs         # core-owned source PCM + filter + player  ✅
└── project/         # binary format: write/read, sections, streaming ✅ (M6: mod/error/sections/read/write)
```

Commands are registered once in `generate_handler![...]`; shared state is
managed via `app.manage(...)`.

**Plugins.** `tauri-plugin-dialog` (native open/save/confirm dialogs) and
`tauri-plugin-window-state` (remembers window size/position/maximized across
launches) are registered in the builder.

## IPC surface (planned)

**Commands** (`invoke`):

| Domain | Command | Notes |
| --- | --- | --- |
| Source | `list_devices`, `list_processes` | flexaudio `devices()` / `processes()` |
| Source | `pick_audio_file` | native open dialog → path (file I/O stays in Rust) |
| Source | `open_source`, `close_source` | file / input / synth; switching source replaces the timeline |
| Capture | `start_capture`, `stop_capture`, `set_capture_gain`, `pause_capture`, `resume_capture` | flexaudio `Stream` |
| Decode | `probe_file` | symphonia metadata (codec, channels, rate, duration) |
| Decode | `stream_file` | `Channel` of PCM chunks for the timeline |
| Synth | `render_synth` | build a fundsp graph, render to PCM ✅ |
| Filter | `set_filter_graph` | install the project filter graph (applied before preview/analysis) ✅ |
| Filter | `render_filtered` | conditioned (channel-selected, filtered) mono PCM for the Timeline overlay ✅ |
| Playback | `preview_region`, `stop_preview`, `set_output_gain`, `preview_position`, `list_output_devices` | cpal output; PCM stays in the core (ADR-9, M3) ✅ |
| Analysis | `run_analysis` | tool id + window + params → result |
| Project | `save_project`, `load_project` | binary file (M6) ✅; native `pick_project_open_path` / `pick_project_save_path` dialogs, `add_recent_project`, `take_pending_open_paths` |
| Window | `confirm`, `close_window` | native confirmation dialog (work-loss prompts) + close ✅ |

> **Implemented so far (M4):** file source uses `pick_audio_file` → `probe_file` →
> `stream_file` (the frontend drives it) rather than `open_source`/`close_source`.
> Live capture uses `list_devices` / `list_processes` and
> `start_capture` / `stop_capture` / `pause_capture` / `resume_capture` /
> `set_capture_gain`. The core owns the source PCM: `stream_file` and
> `render_synth` set it, `begin_capture_source` / `end_capture_source` gate
> capture appends, and `clear_audio_source` drops it. Analysis uses the single
> `run_analysis` command (tool id + window + shared params → typed result); the
> first tools are waveform, spectrum, and spectrogram.
> `open_source`/`close_source` remain the planned unification of the source kinds.

> **Implemented (M6):** `save_project(path, { name, createdMs, source, setup, layout })`
> writes the frontend's descriptor/setup/layout plus the core-owned PCM (ADR-9) as
> the file's `DATA` section, and `load_project(path, onChunk)` validates the file,
> streams `DATA` back to the frontend (for the Timeline waveform), installs the PCM
> in the core, and returns the parsed `META`/`SOURCE`/`SETUP`/`LAYOUT`/`RESULTS`. The
> frontend (`state/project.ts`) restores every store and the dockview layout; the
> analyzer tabs then re-derive their results. See `project-file-format.md` →
> Implemented.

**Channels / events** (Rust → frontend):

- `capture_chunk` (Channel) — 20 ms PCM chunks as the timeline grows (passed to
  `start_capture` as `onChunk`).
- `source_status` — device lost, stall, permission, etc. (flexaudio `Event`).
- `analysis_progress` — long-running analysis updates.
- `app:menu` — a File-menu action id (`new` / `open` / `save` / `saveAs`) from the
  native menu (M6); the frontend runs the matching project action. Choosing an
  **Open Recent** entry is re-emitted as `app:open-project`.
- `app:open-project` — opened `.heyl` paths (file association) for a running app;
  a request that arrives before the frontend listens is drained by the
  `take_pending_open_paths` command (M6).

> **Channel ordering:** Tauri routes a `Channel` message above a size threshold
> through an async `fetch` round-trip and re-orders by index, so the command's
> promise can resolve **before** the last chunk. The one-shot PCM commands
> (`stream_file`, `render_synth`, `load_project`) therefore end their channel with
> a **zero-length sentinel**, and the frontend awaits it (`src/lib/pcmStream.ts`)
> before assembling the buffer — otherwise a short window/buffer is derived from the
> partial PCM.

## Data flow

1. **Open a source** — file (symphonia), input (flexaudio), or synth (fundsp).
2. **Timeline** — the frontend receives PCM (full decode for file/synth, growing
   stream for inputs) and renders the waveform + window range.
3. **Filter (optional)** — the user edits a fundsp graph in the **Filter graph**
   Workbench tab (`solid-flow`); the Rust backend (`audio/graph.rs`) compiles it to
   a fundsp `Net` applied before preview and analysis.
4. **Analysis** — the user opens analyzer tabs in the Workbench; `run_analysis`
   computes results via oxiaudio over the selected window, respecting shared
   params.
5. **Persist** — `save_project` writes source data, setup/layout, and results to
   the binary project file.

## Threading

- Capture: flexaudio `Stream::poll_chunk` runs on a dedicated thread; chunks go
  into a ring buffer and are forwarded to the frontend via a `Channel`.
- Analysis/decode: async commands run on `tauri::async_runtime` (never block the
  main thread); fundsp audio callbacks never allocate.
- Playback (ADR-9): one `cpal` output stream per app, opened lazily and kept open,
  fed from a shared mono buffer loaded per preview region (mixdown → filter →
  resample). The stream is `!Send` on macOS, so it lives on a dedicated worker
  thread; the audio callback and the command side share an `Arc<Mutex<…>>`.
- The frontend is single-threaded (SolidJS); heavy PCM is streamed, not posted
  as one giant JSON blob.

## Analysis execution model

**Analysis never runs on the UI thread.** Sliders/tools live in the WebView (JS
thread); analysis runs in Rust.

- Frontend: a param/window change updates the relevant Solid store and schedules
  a debounced `run_analysis` invoke (~200 ms trailing; dragging coalesces).
- Rust: `run_analysis` is an async command on `tauri::async_runtime`; the
  CPU-bound oxiaudio work is wrapped in `spawn_blocking` so it runs on the
  blocking pool, leaving the async workers free for capture/decode.
- Results return via the invoke promise; long runs stream progress via a
  `Channel`.

> **Implemented (M4):** the frontend (`state/analyzer.ts`) debounces auto-run on
> the source / window / shared params / filter, and keeps results latest-wins with
> a per-tool generation counter. Progress streaming and core-side mid-run
> cancellation are deferred to the expensive tools (M5).

**Trigger policy:**

- Timeline window markers → **preview playback** (audio streaming, no analysis);
  the *settled* window then re-analyzes open tools (debounced).
- Tool params (FFT size, hop/overlap, …) → debounced auto-run, no button.
- Expensive tools (tempo, chromagram, long-window spectral) may opt into an
  explicit **Run** button instead of auto-run.

**Superseding & cancellation:**

- Each tool carries a generation counter; a new request bumps it and invalidates
  in-flight results (latest-wins). Long analyses check the counter between
  blocks to abort early.
- Results are cached keyed by `(source, window, params)` so unchanged tools are
  not recomputed.

## Security

- The window capability currently grants only `core:default`; every future
  command is registered and, if needed, gated by `allow-<command>` permissions
  in `capabilities/*.json`.
- `csp` is `null` for the shell; tighten before shipping remote content (none
  planned — all content is local).
