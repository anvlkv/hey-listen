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
│  project store (binary)      │        │  UI state (Solid stores,      │
│  project UI state (per win)  │        │   views of the core)          │
└──────────────────────────────┘        └────────────────────────────────┘
```

- The Rust core owns all audio I/O, decoding, analysis, and the project file — and
  the project's shared **UI state** (timeline window, analysis params, per-tool
  options and chart views, project name), which it syncs across a project's windows
  (ADR-11).
- The frontend owns layout, tool/tab management, graph editing, and charts; its
  Solid stores are **views** of the core's UI state, not the source of truth.
- Audio PCM crosses the boundary **only** through ordered `tauri::ipc::Channel`
  streams (not events); results and commands are JSON over `invoke`.

## Rust module layout

Existing modules are marked ✅; the rest are the target structure.

```
src-tauri/src/
├── main.rs          # desktop entry (calls lib::run)            ✅
├── bin/
│   ├── heylisten-mcp.rs  # stdio MCP entry (plain console)         ✅ (M9)
│   └── heylisten-cli.rs  # batch CLI entry (plain console)         (M10)
├── lib.rs           # Builder setup, state, handler registration ✅
├── commands/        # #[tauri::command] surface, grouped by domain
│   ├── mod.rs       # ✅
│   ├── source.rs    # enumerate devices/processes, open/close sources ✅ (pick_audio_file, clear/begin/end capture source, load_shared_source)
│   ├── decode.rs    # open file, decode range / stream          ✅ (probe_file, stream_file)
│   ├── capture.rs   # start/stop/gain/pause recording           ✅
│   ├── graph.rs     # filter/synth graph commands               ✅ (set_filter_graph, render_synth)
│   ├── playback.rs  # preview playback (cpal)                   ✅
│   ├── analysis.rs  # run analysis over a window                ✅ (run_analysis)
│   ├── project.rs   # save/load binary project file               ✅ (M6: save/load_project, pick_project_*_path)
│   ├── ui.rs        # project UI-state sync                      ✅ (M7: get_ui_state, set_ui_state)
│   ├── window.rs    # window management                           ✅ (M7: open_project_window, open_popout_window, popout_tool(s))
│   └── mcp.rs       # MCP tool-call replies + settings            ✅ (M9: mcp_respond, mcp_ready, get_mcp_status, set_mcp_config)
├── audio/           # engines (not commands)
│   ├── mod.rs       # ✅
│   ├── decode.rs    # symphonia demux/decode -> PCM            ✅
│   ├── capture.rs   # flexaudio Stream poll loop -> ring buffer ✅
│   ├── graph.rs     # fundsp Net: compile (push + connect) / apply / render ✅
│   ├── pcm.rs       # channel mixdown + linear resample        ✅
│   ├── playback.rs  # cpal output stream + ring buffer         ✅
│   └── analysis.rs  # oxiaudio wrappers                         ✅
├── app_activity.rs  # keep the process out of macOS App Nap        ✅ (M9 follow-up)
├── engine.rs        # headless engine session: source + shared params + tool options + window (shared by mcp/headless and the batch CLI; from mcp/dispatch.rs)
├── cli/             # command-line interfaces
│   ├── app.rs       # the app binary's tauri-plugin-cli flags      ✅ (M9: --mcp / --headless)
│   └── batch.rs     # the `heylisten-cli` clap front end           (M10)
├── menu.rs          # native menu (File/Edit/View/Window/Help) ✅ (M6: File → frontend; Edit → undo/redo; M7: New Window)
├── recent.rs        # recent project files (app config dir)    ✅ (M6: backs Open Recent)
├── state.rs         # per-window core state registry            ✅ (M7: WindowRegistry; audio PCM + filter + player + capture + shared UI state)
├── project/         # binary format: write/read, sections, streaming ✅ (M6: mod/error/sections/read/write)
└── mcp/             # MCP server (agent access + UI following)     ✅ (M9: mod/protocol/tools/server/bridge/settings/headless; its `dispatch` session moves to `engine.rs` in M10)
```

Commands are registered once in `generate_handler![...]`; shared state is
managed via `app.manage(...)`.

**Binaries.** Three: `hey-listen` (the GUI, the bundle's `default-run`), and two
**plain console** binaries that link the lib but never start Tauri — `heylisten-mcp`
(the stdio MCP entry, M9) and `heylisten-cli` (the batch CLI, M10). A console binary
is required wherever there is no window to print from: the Windows release (the app
binary has no console) and GUI-less hosts / CI. See [`cli.md`](cli.md).

**Per-window state (M7).** With N project windows (ADR-3), the core's project state
— the source PCM, filter graph, preview player, capture session, and the project's
**shared UI state** — is resolved from a `state::WindowRegistry` keyed by window
label: every command takes a `WebviewWindow` and calls `state::window_state(&window)`.
The registry entry is dropped when the window is destroyed (which also shuts its
preview player down). App-wide stores (recent projects, pending open files) stay
shared.

**Windows are views (ADR-11).** A project's **UI state** — the timeline window and
viewport, the shared analysis params, the per-tool options and chart views, and the
project name — lives in the **core**, in `WindowState::ui` (a key → JSON map; the
frontend owns the shape). `get_ui_state` hands a freshly opened window the whole
snapshot, `set_ui_state` stores a patch and **emits `ui-state` to the project's
other windows**, and the frontend bridge (`src/state/uiSync.ts` + `uiState.ts`) pulls,
pushes, and mirrors it. So the main window and its popouts are views of **one** state
instead of diverging JS copies. A **popout** window is aliased to its parent (its
`WindowRegistry` entry resolves to the parent's `WindowState`), so it shares the
source, the filter, and the UI state while still being a real Tauri window.

**The app must stay responsive in the background.** Both features that run without
focus — the **MCP server** (an agent drives the app from another window) and **live
capture** (recording continues while the user works elsewhere) — break under macOS
**App Nap**, which coalesces a background app's timers, lowers its priority, and can
suspend it. So the process declares itself **user-initiated** for its lifetime
(`app_activity::prevent` → `NSProcessInfo.beginActivity`), and the bundle's
`Info.plist` sets `NSAppSleepDisabled` (see [`mcp.md`](mcp.md)). Nothing in the app
polls on a timer while the app is in the background.

**Plugins.** `tauri-plugin-dialog` (native open/save/confirm dialogs),
`tauri-plugin-window-state` (remembers window size/position/maximized across
launches), `tauri-plugin-cli` (the app binary's `--mcp` / `--headless` flags,
declared in `tauri.conf.json` → `plugins.cli`), `tauri-plugin-store` (the persisted
MCP settings) and `tauri-plugin-clipboard-manager` (the popover's Copy button) —
both added with M9 — and `tauri-plugin-log` (file + stdout logging) are registered in
the builder; the frontend wires the same log sink up with `@tauri-apps/plugin-log`'s
`attachConsole()` (`src/index.tsx`) so `console.*` and JS errors land in the log too.
Logging writes to the app's log directory — on macOS
`~/Library/Logs/com.anvlkv.heylisten/hey-listen.log` — starting a **fresh file on
every launch** (`FileOpenStrategy::Rotate`) and rotating once it exceeds 2 MB
(`max_file_size`, `RotationStrategy::KeepSome(3)`).

## IPC surface

The commands and channels below are all implemented; milestone notes record the details.

> **Type exchange (ts-rs).** The structured types crossing IPC (shared params,
> analysis results, device/process DTOs, project sections) are defined once in Rust
> with `#[derive(ts_rs::TS)]`; `cargo test` exports their TypeScript definitions to
> `src/bindings/`, and the frontend imports them instead of hand-mirroring the
> shapes. See [`dependencies.md`](dependencies.md) → Tooling notes.

**Commands** (`invoke`):

| Domain | Command | Notes |
| --- | --- | --- |
| Source | `list_devices`, `list_processes` | flexaudio `devices()` / `processes()` |
| Source | `pick_audio_file` | native open dialog → path (file I/O stays in Rust) |
| Source | `open_source`, `close_source` | file / input / synth; switching source replaces the timeline |
| Source | `load_shared_source` | the shared source's shape (rate/channels/frames/duration) — a popout renders a tool without the PCM ✅ |
| Capture | `start_capture`, `stop_capture`, `set_capture_gain`, `pause_capture`, `resume_capture` | flexaudio `Stream` |
| Decode | `probe_file` | symphonia metadata (codec, channels, rate, duration) |
| Decode | `stream_file` | `Channel` of PCM chunks for the timeline |
| Synth | `render_synth` | build a fundsp graph, render to PCM ✅ |
| Filter | `set_filter_graph` | install the project filter graph (applied before preview/analysis) ✅ |
| Filter | `render_filtered` | conditioned (channel-selected, filtered) mono PCM for the Timeline overlay ✅ |
| Playback | `preview_region`, `stop_preview`, `set_output_gain`, `output_level`, `preview_position`, `list_output_devices` | cpal output; PCM stays in the core (ADR-9, M3) ✅ |
| Analysis | `run_analysis` | tool id + window + params → result |
| Project | `save_project`, `load_project` | binary file (M6) ✅; native `pick_project_open_path` / `pick_project_save_path` dialogs, `add_recent_project`, `take_pending_open_paths` |
| Window | `confirm`, `close_window` | native confirmation dialog (work-loss prompts) + close ✅ |
| Window | `open_project_window` | open a new, independent project window (M7) ✅ |
| Window | `open_popout_window`, `popout_tool`, `popout_tools` | open/query a popout window for a tool (M7) ✅ |
| Window | `focus_popout` | raise an already-popped-out tool instead of opening a duplicate tab (M7) ✅ |
| UI | `get_ui_state`, `set_ui_state` | the project's shared UI state: pull / patch + broadcast (M7, ADR-11) ✅ |
| MCP | `mcp_respond`, `mcp_ready` | a window's reply / readiness for a forwarded MCP tool call (M9) ✅ |
| MCP | `get_mcp_status`, `set_mcp_config` | the MCP server's status / config (on-off + port), owned by `mcp::settings::McpController` (M9) ✅ |

> **Implemented (M9 follow-up):** `get_mcp_status` / `set_mcp_config` expose the
> server's on/off + port (persisted with `tauri-plugin-store`; the Toolbar MCP
> popover is a view over them). `heylisten-mcp` (and `hey-listen --mcp`) auto-detects
> bridge vs a **headless** core-native dispatcher (`mcp/dispatch.rs`), and the server
> answers `list_projects` plus routes any tool to a window named by `target`. See
> [`mcp.md`](mcp.md).

> **Implemented:** file source uses `pick_audio_file` → `probe_file` →
> `stream_file` (the frontend drives it) rather than `open_source`/`close_source`.
> Live capture uses `list_devices` / `list_processes` and
> `start_capture` / `stop_capture` / `pause_capture` / `resume_capture` /
> `set_capture_gain`. The core owns the source PCM: `stream_file` and
> `render_synth` set it, `begin_capture_source` / `end_capture_source` gate
> capture appends, and `clear_audio_source` drops it. Every analysis tool (M5) is
> dispatched through the single `run_analysis` command (tool id + window + shared
> params → typed result).
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
- `app:menu` — a File-menu action id (`new` / `newWindow` / `open` / `save` /
  `saveAs`) or an Edit action (`undo` / `redo`) from the native menu (M6, M7); the
  frontend runs the matching project action. Emitted to the **focused window**
  (multiple windows, M7); choosing an **Open Recent** entry is re-emitted as
  `app:open-project`.
- `app:open-project` — opened `.heyl` paths (file association); routed to the focused
  window, or queued once for the first frontend if none is listening yet (M6, M7).
- `ui-state` — one UI-state patch (`{ key, value, source }`) emitted to the project's
  **other** windows when `set_ui_state` changes a value (M7, ADR-11); the sender is
  skipped, and each receiver applies the patch to its stores.
- `mcp:request` — one MCP tool call (`{ id, tool, arguments, target }`) forwarded to a
  project window's frontend, which runs the tool and answers through the
  `mcp_respond` command (M9); `target` is the resolved project window label. See
  [`mcp.md`](mcp.md).

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
   stream for inputs) and renders the waveform + window range. It is a **view only**
   for the waveform: the **core owns the source PCM** (ADR-9); the frontend keeps a
   transitional duplicate just for the Timeline (see `decisions.md`).
3. **Filter (optional)** — the user edits a fundsp graph in the **Filter graph**
   Workbench tab (`solid-flow`); the Rust backend (`audio/graph.rs`) compiles it to
   a fundsp `Net` applied before preview and analysis.
4. **Analysis** — the user opens analyzer tabs in the Workbench; `run_analysis`
   computes results via oxiaudio over the selected window, respecting shared
   params.
5. **Persist** — `save_project` writes source data, setup/layout, and results to
   the binary project file.

### Multiple windows, one project

A **popout** is a second *view* of the same project (ADR-11), not a second project.
Both windows drive the same core state:

```
            ┌───────────────────────────────┐
            │ Rust core                      │
            │  WindowRegistry {              │
            │    main    → WindowState        │
            │      audio  (source/filter/…)   │
            │      ui     (timeline/params/…) │
            │    popout-N  ⇒ aliased to main  │
            │  }                              │
            └────────────▲─────────┬──────────┘
       get_ui_state /      │         │  ui-state (event)
       run_analysis …      │         ▼
                 ┌─────────┴──┐   ┌──────────────┐
                 │ main window │   │ popout-N      │
                 └─────────────┘   └──────────────┘
```

- Commands from either window resolve to the **same** `WindowState` (the popout's
  label is aliased to its parent), so analysis reads one source.
- A UI edit in either window calls `set_ui_state`, which stores the value and emits
  `ui-state` to the other windows, which apply it — so the timeline window, params,
  chart zoom, and project name stay in lockstep.

## Threading

- **Synchronous `#[tauri::command]`s run on the app's main thread** (the WebView's IPC
  callback thread). A synchronous command that blocks — a thread join, OS audio
  enumeration, disk I/O — therefore freezes the whole UI, and holding a `Mutex`
  across it can stall every other thread that needs the same state. So any command
  whose body can block is **`async`** (it runs on `tauri::async_runtime`) and puts the
  blocking part on `spawn_blocking`. The blocking commands are the capture ones
  (`start_capture` / `stop_capture` open/stop the OS backend and **join** the poll
  thread; `list_devices` / `list_processes` enumerate), `list_output_devices`
  (cpal enumeration), `probe_file` (symphonia header read), `set_filter_graph`
  (fundsp graph build), and `add_recent_project` (recent-list write + menu rebuild).
  No lock is ever held across one of those blocking calls (e.g. the capture session
  is taken out of its `Mutex` before it is stopped, and a closed window's state is
  dropped outside the window registry lock).
- Capture: flexaudio `Stream::poll_chunk` runs on a dedicated thread; chunks go
  into a ring buffer and are forwarded to the frontend via a `Channel`.
- Analysis/decode: async commands run on `tauri::async_runtime` (never block the
  main thread); fundsp audio callbacks never allocate.
- Playback (ADR-9): one `cpal` output stream per **window** (M7), opened lazily and
  kept open, fed from a shared mono buffer loaded per preview region (mixdown →
  filter → resample). Each stream is `!Send` on macOS, so it lives on a dedicated
  worker thread; the audio callback and the command side share an
  `Arc<Mutex<…>>`. The callback also tracks the output block's peak for the
  `output_level` meter.
- The frontend is single-threaded (SolidJS); heavy PCM is streamed, not posted
  as one giant JSON blob. The **core owns the source PCM** (ADR-9) and each
  project's **shared UI state** (ADR-11); the frontend keeps only the transitional
  waveform copy and drives the UI.

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

- The window capability grants `core:default`, `core:window:allow-set-title`, and
  `log:default` to the app's windows (`windows: ["main", "project-*", "popout-*"]` —
  the label globs match every project window, every window opened via New Window, and
  every **popout**). Every future command is registered and, if needed, gated by
  `allow-<command>` permissions in `capabilities/*.json`. A popout is a real Tauri
  window (not a `window.open` popup), so it has its own capability and runs its own
  frontend — see `ui-layout.md`.
- `csp` is `null` for the shell; tighten before shipping remote content (none
  planned — all content is local).
