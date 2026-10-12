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

## M7 — Multi-window + polish + packaging ✅

- N independent project windows; 
- Popout any tab in a separate window. Title reflects the tab name and source. Selecting the tab in main window should focus the secondary window.
- bundle; github workflows for releases; platform matrix.
- all pure numeric inputs should be refactored to allow dragging (up high, down low, no slider just a visual hint) as well as typing
- Toolbar polish: drop the temporary `Rust backend:` debug status (the M0 ping
  scaffold) and add a preview **output meter** beside the output gain/device.
- chart readout bar shouldn't change height. reserve enough space for each entry upfront
- hide or better swap timeline and sources panel. add button to replace source.

> Delivered: **N independent project windows** — the core's per-project state (source
> PCM, filter graph, preview player, capture session, **shared UI state**) moved from
> one app-wide value to a `state::WindowRegistry` keyed by window label, so each window
> is independent (ADR-3); **File → New Window** (`open_project_window`) opens a fresh
> one, and the File/Edit menu actions now route to the **focused** window instead of
> broadcasting.
> **Tab popout** is a **native Tauri window** (`open_popout_window`): a first cut rode
> dockview's `addPopoutGroup` (`window.open`), but that popup crashes on macOS loading
> `tauri://…` through the custom URL-scheme handler (the handler is only wired for a
> full wry webview), so only Tauri/wry create the window now and the frontend just
> renders. A popout is a *view* of the **same** project (its label is aliased to the
> parent's `WindowState`), shows only its tool, is titled `<tool> — <project>`,
> reopens on project load (recorded in `LAYOUT`), and is closed with its parent.
> Selecting a popped-out tool in the Sidebar raises its window (`focus_popout`)
> instead of opening a duplicate tab, while a new tool opens in the main window.
> **Windows are views of one state (ADR-11).** The project's UI state — timeline
> window/viewport, analysis params, per-tool options and chart views, project name —
> lives in the core; `get_ui_state`/`set_ui_state` + the `ui-state` event keep the main
> window and its popouts in lockstep (`src/state/uiSync.ts` + `uiState.ts`), so zoom,
> the analysis window, and params sync **across windows**. **Packaging**:
> `.github/workflows/ci.yml` + `release.yml` build the platform matrix via
> `tauri-action`, documented in [`packaging.md`](packaging.md). **Numeric inputs**
> (Kobalte `NumberField`s, graph node params, the synth length) gained drag-to-adjust
> (`src/lib/dragNumber.ts`, an `ns-resize` cursor as the only affordance — no slider)
> alongside typing. **Toolbar**: the preview **output meter** sits beside gain/device,
> fed by the new `output_level` command (the cpal callback tracks the block peak); the
> temporary `Rust backend:` status was already gone. The **chart readout bar** reserves
> a stable height and per-entry width so it never reflows (and no longer draws a
> scrollbar). The bottom row now **swaps in place** by context — no source ⇒ a compact
> horizontal **Add audio** strip fills the row (the row is resizable only when the
> Timeline is); recording ⇒ Source beside the Timeline; a source present and idle ⇒
> Timeline only, with the Timeline's **Replace…** button. The **Sidebar width** is
> draggable, lists use a custom transform-based `ScrollArea` (no native scrollbar on
> macOS), chart zoom is clamped to the data extent, and **frontend logs**
> (`attachConsole`) join the Rust ones in `hey-listen.log`.

## M8 — E2E test suite ✅

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
  channel select, project save/load, popout window). A handful of correctness
  spot-checks on the known
  fixture is the only numeric coverage — no per-tool regression suites.
- GitHub Actions CI on the platform matrix (macOS / Linux / Windows); capture is
  covered by an automated error-path test, the granted happy path a manual smoke
  (TCC prompts need a signed bundle).

> Depends on M6 (project save/load) and M7 (popout) for the persistence and
> multi-window scenarios; everything else can be exercised from M5.

> **Delivered:** WebdriverIO + `@wdio/tauri-service` driving the **release** binary
> through the system WebView with the **embedded** driver
> (`tauri-plugin-wdio-webdriver`, registered in `lib.rs`) and `tauri-plugin-wdio`
> for `browser.tauri.execute()`. `wdio.conf.ts` + `e2e/` (generated `.fixtures`,
> `support` helpers, 9 spec files, gitignored `artifacts`) deliver **57 tests**:
> the shell/layout, all source kinds, both graph editors, a **parametrized smoke
> test over all 26 analyzers**, five correctness spot-checks, the cross-cutting
> scenarios (search / no-duplicate / shared-param / zoom-sync / popovers), the
> timeline, project save/load + popout, the five error/warning surfaces, and the
> native-dialog-safe IPC mocking described below.
> Deterministic fixtures (440 Hz, chirp+noise, stereo, corrupt, a `sine→output`
> synth graph) are generated in `onPrepare` into the gitignored `e2e/.fixtures/`.
>
> **Native dialogs are always mocked.** WebDriver can't drive native OS/Tauri
> modals (they block the webview), so `setMock`/`restoreMocks` always seed the dialog
> commands (`confirm` → true; the file pickers → `null`).
>
> **IPC mocking deviation:** `@wdio/tauri-plugin`'s `mock()` patches
> `window.__TAURI__.core.invoke`, but Tauri injects `__TAURI_INTERNALS__` as
> non-writable/non-configurable and the app goes through the bundled
> `@tauri-apps/api`, so it can't intercept app calls. The app therefore routes every
> command through `src/lib/ipc.ts`, a small façade with a documented test override
> (`__heylisten_test__`); `wdio.conf.ts` never sets it, so production is unchanged.
> See [`testing.md`](testing.md) → IPC mocking. The suite drives **one** app instance
> for the whole run, so fixtures are duration-aware and the popout spec runs last.

## M9 — MCP server (agent access + UI following) ✅

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
>
> **Delivered:** `src-tauri/src/mcp/` (`mod` / `protocol` / `tools` / `server` /
> `bridge`) hosts a **Model Context Protocol** server **in the app**, on a loopback
> TCP endpoint advertised (with a token) in `mcp.json` under the app config dir; the
> `heylisten-mcp` binary (and `hey-listen --mcp`) is a stdio ⇄ socket **bridge**, so
> an MCP client reaches the *running* app. Every `tools/call` is forwarded to the
> focused project window's frontend (`mcp:request`) and answered through the
> `mcp_respond` command, so the agent drives the **same** stores and commands the UI
> does — `src/state/mcp.ts` implements the tools and `src-tauri/src/mcp/tools.rs`
> carries the catalog (open a source, run every analyzer, edit the filter/synth
> graphs, preview, capture, save/load projects). **UI following** is automatic in
> both directions: agent calls open tabs / set the analysis window / replace the
> timeline in the live window, and `get_state` reports the source, window, params,
> open tabs, and project. See [`mcp.md`](mcp.md) (ADR-12).

### M9 follow-up — control, headless CLI, multi-project (planned)

The first cut ships the server + UI following. A scoped follow-up adds the
user-facing control surface and the pieces that make the agent genuinely
standalone:

- **In-app MCP control** — a Toolbar **MCP** popover: an **on/off toggle (default
  off)**, a **port input** (default `47100`, free-port fallback, inline "port in use"
  error), a live status line, and a **copyable** Zed `context_servers` snippet
  (rendered from `current_exe()` + `["--mcp"]`, and the `heylisten-mcp` sibling).
  Persisted with `tauri-plugin-store`; copied via `tauri-plugin-clipboard-manager`.
- **Headless MCP-only CLI** — `heylisten-mcp` **auto-detects**: when a running app
  has MCP enabled it bridges to it (UI following, as today); otherwise it runs a
  **core-native** dispatcher over stdio with no window. `--headless` forces headless.
  The headless subset is the compute/audio surface (open file, run every analyzer,
  filter/synth, preview, enumerate, capture); UI-only tools (`open_tool`/`close_tool`,
  editor-layout graphs, save/load) return "requires the app".
- **Multi-project targeting** — `list_projects` plus an optional `target` on every
  tool, so one port reaches **any** of a process's project windows (main / `project-*`
  / popouts) instead of only the focused one.

> **Decisions (committed):** default **off**; port default **47100**; `heylisten-mcp`
> auto-detects (bridge vs headless) with a `--headless` escape hatch; the headless
> tools are the **engine-backed subset** (no second DSP path — the GUI commands and
> the headless dispatcher call the same extracted core functions); multi-project is
> in-scope via `list_projects` + `target`. Persistence = `tauri-plugin-store`;
> clipboard = `tauri-plugin-clipboard-manager`; `port_check` is skipped (the bind is
> the check). See [`mcp.md`](mcp.md) (ADR-13).

## Backlog ✅ (delivered)

Implemented after M6 as one batch. Where the delivered behaviour is narrower than
originally scoped, a note follows the item.

- **Undo / redo ✅.** App-level snapshot history (`src/state/history.ts`) over graph
  edits, layout/tab changes, shared params, tool options, and the timeline window,
  with native **Edit** menu items (`CmdOrCtrl+Z` / `Shift+CmdOrCtrl+Z`). Continuous
  edits coalesce into one step; history resets on New / Open. *(Menu items stay
  enabled; the handlers no-op on an empty stack.)*
- **Full fundsp node coverage ✅.** The palette covers every filter family and their
  control-input variants, dynamics, modulation, reverbs, **math**
  (`add`/`subtract`/`multiply`/`divide`/`min`/`max`/`abs`/`invert`), and
  panning/stereo nodes — see [`graph-editor.md`](graph-editor.md). The palette has a
  **search box** and is **collapsible**; nodes can be **clicked or dragged** onto the
  canvas, and a node dropped **onto a connector** is spliced in, splitting the edge;
  every port carries a **tiny label** and every node a **hint**; `input`/`output` are
  undeletable (and draggable). *(The `Sequencer`, an expander, and the remaining
  fundsp nodes listed under "Remaining fundsp nodes" in `graph-editor.md` stay
  deferred.)*
- **Timeline filtered overlay ✅.** The filtered signal is drawn over the raw
  waveform, with an on/bypassed badge (`render_filtered` streams the conditioned
  mono signal). See [`ui-layout.md`](ui-layout.md).
- **Stereo graphs ✅ + parameter smoothing ✅.** *(Delivered as graph-level stereo —
  option B: the net's global I/O stays mono, but internal stereo/panning/`2→2` nodes
  are supported. Smoothing applies `follow` to control-rate parameters **within** a
  compiled net; click-free smoothing across a full rebuild and a fully stereo
  preview/analysis chain remain deferred.)*
- **Timeline window drag ✅.** Move the whole analysis window (keeping its width) via
  a top handle.
- **Axis label readability ✅.** Wider margins and tick formatters/units for the
  charts and the Timeline ruler.
- **UI font scale ✅.** A user-adjustable 0.8–1.4× scale for the whole interface,
  persisted; lives in the toolbar **View** popover.
- **Light / dark theme ✅.** An **auto / dark / light** setting that themes the UI
  (CSS custom properties), the charts (uPlot strokes/axes, the spectrogram
  background + colormap), and the dockview theme. Lives in the toolbar **View**
  popover.
- **Explanatory tooltips ✅.** On the shared-param choices and the analyzer entries.
- **Spectrum layers ✅.** Toggleable **min / max / mean** magnitude layers in the
  spectrum chart (per-tool params).
- **Drag & drop file ✅.** Drop an audio file onto the window to open it.
- **Prevent work loss ✅.** Prompts before replacing an existing source; a dirty `*`
  in the project name/title and a prompt on close / New / Open.
- **Reframing from charts ✅.** Right-click a time-domain chart to set the window
  start/end (the default context menu is suppressed).
- **Shared params ✅.** Moved to the main toolbar (an **Analysis params** popover).

Also shipped alongside: the preview **filtered overlay**, a collapsible palette,
sticky search boxes, similar custom scrollbars, and
**`tauri-plugin-window-state`** (remembers window size/position across launches).
The temporary **`Rust backend:`** toolbar status was removed.
