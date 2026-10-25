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
> is compiled in Rust (`audio/graph/`). The frontend retains a PCM copy only for
> the Timeline waveform — a transitional duplication, see ADR-9.

## M4 — Analysis engine + first tools ✅

- oxiaudio wrappers; `run_analysis` command; shared FFT params.
- First tools: waveform, spectrum/FFT, spectrogram.

> Delivered: `audio/analysis/` (tool implementations + shared conditioning),
> the single `run_analysis` command, and the shared params store
> (`state/analysis.ts`). Analyzer tabs (waveform / spectrum / spectrogram) are
> Workbench tabs with params + about popovers, listed in the Sidebar under
> **Analyzers**; the shared runner (`state/analyzer/`) debounces auto-run and
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
> tools. `audio/analysis/` dispatches them all through the one `run_analysis`
> command; a per-tool `ToolOptions` carries tool-specific params (band counts, YIN
> threshold, f0 range, bar length, momentary window). The frontend registry
> (`state/analyzer/`) drives a generic view layer
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
> via `take_pending_open_paths`). `state/project/` collects the descriptor + setup +
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
> `support` helpers, 9 spec files, gitignored `artifacts`) deliver **58 tests**:
> the shell/layout, all source kinds, both graph editors, a **parametrized smoke
> test over all 27 analyzers**, five correctness spot-checks, the cross-cutting
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

## M8.A Improvements iteration ✅ (delivered)

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
  persisted; lives in the toolbar **Appearance** popover (formerly **View**).
- **Light / dark theme ✅.** An **auto / dark / light** setting that themes the UI
  (CSS custom properties), the charts (uPlot strokes/axes, the spectrogram
  background + colormap), and the dockview theme. Lives in the toolbar **Appearance**
  popover. (Extended to exchangeable theme files in M11.)
- **Explanatory tooltips ✅.** On the shared-param choices and the analyzer entries.
- **Icon set, styled tooltips, and an About dialog ✅.** UI controls use a bundled
  **Font Awesome 7 Free (Solid)** font (`src/lib/icons.ts` + `src/components/Icon.tsx`);
  self-evident controls are compacted to **icon + tooltip**, and the native `title`
  hints on controls became the app's own **`Tooltip`** component. A modal **About**
  dialog (the Toolbar's `circle-question` button and native **Help → About**) carries
  the app identity and the required **attributions** (Font Awesome + the runtime
  dependencies). See [`ui-layout.md`](ui-layout.md) → "Icons, tooltips, and About".
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
> TCP endpoint advertised (with a token) in `mcp.json` under the app data dir; the
> `heylisten-mcp` binary (and `hey-listen --mcp`) is a stdio ⇄ socket **bridge**, so
> an MCP client reaches the *running* app. Every `tools/call` is forwarded to the
> focused project window's frontend (`mcp:request`) and answered through the
> `mcp_respond` command, so the agent drives the **same** stores and commands the UI
> does — `src/state/mcp/` implements the tools and `src-tauri/src/mcp/tools/`
> carries the catalog (open a source, run every analyzer, edit the filter/synth
> graphs, preview, capture, save/load projects). **UI following** is automatic in
> both directions: agent calls open tabs / set the analysis window / replace the
> timeline in the live window, and `get_state` reports the source, window, params,
> open tabs, and project. See [`mcp.md`](mcp.md) (ADR-12).

### M9.A control, headless CLI, multi-project ✅

The first cut ships the server + UI following. The follow-up adds the user-facing
control surface and the pieces that make the agent genuinely standalone:

- **In-app MCP control** — a Toolbar **MCP** popover: an **on/off toggle (default
  off)**, a **port input** (default `47100`, free-port fallback, inline "port in use"
  note), a live status line, and a **copyable** `mcpServers` snippet
  (rendered from `current_exe()` + `["--mcp"]`, and the `heylisten-mcp` sibling).
  Persisted with `tauri-plugin-store`; copied via `tauri-plugin-clipboard-manager`.
- **Headless MCP-only CLI** — `heylisten-mcp` **auto-detects**: when a running app
  has MCP enabled it bridges to it (UI following, as before); otherwise it runs a
  **core-native** dispatcher over stdio with no window. `--headless` forces headless.
  The headless subset is the compute surface (open file, run every analyzer,
  render synth, enumerate); UI-only tools (`open_tool`/`close_tool`, editor-layout
  graphs, save/load, live preview/capture) return "requires the app".
- **Multi-project targeting** — `list_projects` plus an optional `target` on every
  tool, so one port reaches **any** of a process's project windows (main / `project-*`
  / popouts) instead of only the focused one. `get_state` also reports the window a
  call is looking at.

> **Decisions (committed):** default **off**; port default **47100**; `heylisten-mcp`
> auto-detects (bridge vs headless) with a `--headless` escape hatch; the headless
> tools are the **engine-backed subset** (no second DSP path — the GUI commands and
> the headless dispatcher both call `analysis::run_window` and the other extracted
> core functions); multi-project is in-scope via `list_projects` + `target`.
> Persistence = `tauri-plugin-store`; clipboard = `tauri-plugin-clipboard-manager`;
> `port_check` is skipped (the bind is the check). The app binary's `--mcp` /
> `--headless` flags are declared and parsed with `tauri-plugin-cli`. See
> [`mcp.md`](mcp.md) (ADR-13).

> **Delivered:** `src-tauri/src/mcp/settings.rs` (the `McpController`: persisted
> `{ enabled, port }`, a blocking accept loop (woken by a loopback connection on
> stop), start/stop/rebind),
> `mcp/dispatch/` (the headless session + engine subset), `mcp/headless.rs` (the
> stdio loop), `cli.rs` (the `tauri-plugin-cli` flags), `src/state/mcpSettings.ts` +
> `src/components/McpPopover.tsx` (the popover), the `get_mcp_status` /
> `set_mcp_config` commands, and `list_projects` + `target` routing in
> `mcp/server.rs`. `mcp.json` now lives in the app **data** dir (next to the
> `mcp-settings.json` store file). Tests: `e2e/specs/l-mcp-ui.spec.ts` and the
> `src-tauri/tests/headless_mcp.rs` CLI integration test. On macOS the app opts out
> of **App Nap** — the bundle sets `NSAppSleepDisabled` (`src-tauri/Info.plist`) and
> the process asserts a user-initiated activity at startup (`src-tauri/src/app_activity.rs`),
> because a background app has its timers throttled and can be suspended, and an agent
> drives the app from another window by definition. See [`mcp.md`](mcp.md).

### M9.B analysis result fidelity + agent ergonomics ✅

A dozen `run_analysis` calls to profile a single source is a realistic agent session,
and it surfaced rough edges in **what `run_analysis` returns and what it changes** —
not in the analyzers. This follow-up is about the result shape and side effects.

- **Compute without display.** `run_analysis` always opens (and focuses) the analyzer
  tab, so a sweep leaves a Workbench tab per tool (a 19-tool pass opened 19 tabs). Add
  `display` (bool, default `true`); `display: false` returns the result without opening
  or focusing a tab. Headless is already display-less, so it is a no-op there.
- **Honest compaction.** `compact` is duplicated (`src/state/mcp/` `compact` and
  `src-tauri/src/mcp/dispatch/` `compact`) and reduces a long **all-numeric** array to
  `{ length, min, max }` — but a long array that contains `null`s (a pitch track's
  unvoiced frames) collapses to a bare `{ length }`, hiding that it is almost empty.
  Fix: numeric arrays become `{ length, min, max, argmin, argmax }` (locate the peak
  without `includeData`), and arrays with gaps become
  `{ length, nulls, min, max, argmin, argmax }` (min/max/argmin/argmax over the present
  numbers, `nulls` counted), so "one voiced frame out of 511" is visible at a glance.
- **Bounded `includeData`.** `includeData: true` returns *every* frame (a spectrogram,
  a 511-point pitch track, a 1650-point flux track). Add `maxPoints` (decimate to ≤ N by
  striding, keeping the first and last) so an agent can pull a representative series
  without blowing its context.
- **Echo what a call changed.** `run_analysis(params: {…})` overrides the **shared**
  params globally and silently — the caller must re-read `get_state` and undo it. The
  result should echo the **effective** `params` and `options` it ran with, and add
  `transient` (bool, default `false`): when true, `start`/`end`/`params`/`options` apply
  to this call only and are not written back to the project.
- **Surface degenerate results.** A pitch tracker that finds almost no voiced frames
  still returns a normal success (this is what looked like a constant `1108.7 Hz`). Add
  `voicedFrames` / `voicedFraction` to the three pitch tools' summary so a near-empty
  track is self-evident.
- **Hygiene.** Drop the doubled `tool`/`window` echo (the envelope and the core result
  both carry them); document or drop the opaque `detail: "0x1006"` in the source
  summary; clarify `hop` in the schema — it is the hop as a **fraction of `fftSize`**
  (`0.25` = 75% overlap), which the name does not convey.

> **Decisions (committed):** the flags are `display`, `transient`, `maxPoints`; the
> compacted-array shape is `{ length, min, max, argmin, argmax }` (numeric) /
> `{ length, nulls, min, max, argmin, argmax }` (with gaps). Compaction is byte-for-byte
> the same across the two implementations (`src/state/mcp/` and
> `src-tauri/src/mcp/dispatch/`), covered by a Rust unit test beside
> `compact_collapses_long_numeric_arrays`, and carries through the CLI's `--full` /
> compacted default (M10). A **`summary`** verb is still **not** built (out of scope). See
> [`mcp.md`](mcp.md).

> **Delivered:** `run_analysis` gained `display` (default `true`), `transient`,
> `maxPoints`, and echoes `params`/`options`; its envelope dropped the duplicated `tool`
> (the result is tagged) and kept `window`. The result shaping (`compact` + `decimate`)
> lives in both `src/state/mcp/` and `src-tauri/src/mcp/dispatch/`, kept identical,
> with Rust unit tests beside `compact_collapses_long_numeric_arrays`; the batch CLI
> carries the same compacted default / `--full` behavior automatically (it drives the
> same headless session). The source summary dropped the opaque `detail`; the `hop`
> schema now says it is a fraction of `fftSize`. The three pitch tools return a new
> `PitchResult` carrying `voicedFrames`/`voicedFraction`. The pYIN spike stays **open**
> (below): the detector is in the external `oxiaudio` crate, so it cannot be fixed here —
> the voiced-frame summary surfaces the undercount meanwhile. See [`mcp.md`](mcp.md).

**Spike — pYIN voiced-frame undercount.** On the Blue-capped Ifrit clip `pitchPyin`
returned a single voiced frame (one non-null value in 511) while YIN and
autocorrelation tracked normally. The detector itself lives in the external `oxiaudio`
crate (`oxiaudio::dsp::detect_pitch_pyin`), so the fix is upstream, not in this
repo — still **open**. The `voicedFrames`/`voicedFraction` summary (above) at least makes
the undercount self-evident to an agent.

## M10 — Batch CLI (`hey-listen analyze`) ✅

A **subcommand of the app binary** that runs the analysis engine over files from a
shell with no window — so a script or CI job can do **bulk analysis** and read the
results as JSON. The non-MCP sibling of the headless MCP server (same engine, friendlier
calling convention).

- **Declared with `tauri-plugin-cli`.** The interface lives in `tauri.conf.json` →
  `plugins.cli` (subcommands `analyzers` / `analyze` / `synth`), parsed by the plugin —
  the same mechanism as `--mcp` / `--headless`, and the project's single source of truth
  for the interface. Because the plugin needs an app context, the CLI is the app binary,
  not a separate program.
- **Runs in `setup`, windowless.** `setup` resolves the entry (`--mcp` → MCP, a
  subcommand → batch, else GUI); the batch command prints JSON and exits **before any
  window is created** — it never opens, shows, or drives a window (no webview, no IPC,
  no UI following).
- **Shape.** `analyzers [--json]` (list the catalog), `analyze <FILE>...` (decode + run
  analyzers over a window), `synth <GRAPH.json>` (render a synth graph, then analyze it).
  Shared params (`-p k=v`), per-tool options (`-o k=v`), a filter graph (`--filter`), a
  window (`--start`/`--end`), `--full` (raw arrays) vs the default compacted output, and
  `--fail-fast`. JSONL by default (one object per `file`/`tool`, `jq`-streamable),
  `--pretty` for one result; exit `0`/`1`/`2`.
- **One engine path.** It drives the same headless session the headless MCP server uses,
  so it reuses `analysis::run_window`, `audio::decode`, and `audio::graph` exactly — no
  second DSP path.
- **Scope = the compute subset.** UI-only tools (tabs, editor-layout graphs, project
  save/load, live preview/capture) are out, as in headless MCP. Device enumeration is
  deferred (macOS output enumeration touches the AudioUnit/permission path a batch tool
  must never trigger).
- **Known trade-offs.** The Windows release has no console (the app binary cannot write
  to the calling shell), and a Tauri app needs a platform event loop, so a *bare*
  GUI-less host is still served by `heylisten-mcp --headless`, not this CLI.

> **Decisions (committed):** the CLI is **the app binary via `tauri-plugin-cli`**
> (subcommands, not a hand-rolled parser and not a third binary — the plugin needs an
> app context); it runs in `setup` and **never creates or drives a window**; analyzer
> ids are validated against `audio/analyzers.rs` (not enumerated in config); output is
> **JSONL** (compacted by default, `--full` for raw); it is **standalone** (never
> bridges); `--filter` takes a `GraphSpec` directly (the one place the CLI is a step
> ahead of the MCP subset). See [`cli.md`](cli.md) (ADR-14).

> **Delivered:** `src-tauri/src/cli/` (`mod.rs`: the plugin flags + the `setup` entry
> — `--mcp` → MCP, a subcommand → batch, else GUI; `batch.rs`: `Matches` → a plain
> `Request` → the headless session, JSONL output, unit tests). The three subcommands
> are declared in `tauri.conf.json` → `plugins.cli` (`analyzers` / `analyze` / `synth`)
> and parsed by `tauri-plugin-cli`; `cli::batch::run` writes JSONL to a `Write` (so
> `cargo test` covers it with no app and no display) and the app exits with `0`/`1`,
> while a batch usage error prints and exits `2` instead of opening the GUI. The shared
> session's `set_filter_graph` tool (now also exposed headless, so the MCP server and the
> CLI share it) backs `--filter`. Analyzer ids are validated by the
> engine at run time (`audio/analyzers.rs`), so an unknown id is an `error` line + exit
> `1`. Per-tool options are scoped with `-o <TOOL>.<KEY>=<VALUE>` (a bare `KEY=VALUE`
> works when a single tool is given), because the plugin's matches do not preserve the
> order of flags on the command line. See [`cli.md`](cli.md) (ADR-14).

## M11 — Exchangeable themes ✅

Make the theme **data**: a theme is a loadable file that drives the whole UI, not just a
dark/light switch. The built-in dark and light become the defaults; a theme is a partial
overlay on one of them, and `auto` resolves through chosen dark/light **slots**.

- **`ThemeFile` model** (`.heyltheme`, JSON): `meta.base` (`dark`/`light`) plus optional
  `ui` (CSS custom properties), `chart` (`ChartTheme` fields), `colormap` (ramp stops),
  and `flow` (`--xy-*`) overlays. Reuses the existing four palette sources as the base.
- **Built-ins + slots.** `builtin:dark` / `builtin:light` are full themes in the
  registry; the preference becomes a **mode + two slots** (`darkThemeId` / `lightThemeId`),
  with `auto` following the OS to pick a slot.
- **Apply pipeline.** Set `data-theme = base`, write the `ui` overlay as inline custom
  properties on the root, merge `chart`, swap the colormap; `resolvedTheme()` becomes the
  active base (dockview / `solid-flow` follow it).
- **Storage + UI.** `<app config>/themes/`; Rust `list/read/write/delete/import/export`;
  the Toolbar **View** popover becomes **Appearance** (mode + dark/light slots + import /
  export / delete / reveal folder). Persisted app-level (localStorage), **not** in the
  project file.
- **Agent surface.** MCP `list_themes` / `get_theme` / `set_theme` (+ import/export).

> **Decision (committed):** themes default to the existing dark/light and may be assigned
to either slot; a theme is a **partial overlay** on its `base` (so it stays
forward-compatible), and its base drives dockview / `solid-flow`. See
[`theming.md`](theming.md) (ADR-15).

> **Delivered:** `src/lib/themeFile.ts` (the `ThemeFile` model + parse/validate/
> normalise, with unit checks in `scripts/themeFile.test.ts` → `npm run test:unit`);
> `src/state/themes/` (the registry, slots, apply pipeline, and the four base
> palettes); `src-tauri/src/themes.rs` + `commands/themes.rs` (the byte store +
> list/write/delete/import/export/reveal commands); the Toolbar **Appearance**
> popover (mode + dark/light slots + import/export/delete/reveal). `ChartTheme` /
> `chartTheme` / `resolvedTheme` moved into `themes/`; `colormap.ts` and
> `GraphEditor` read the active theme; `src/styles/` is unchanged (the base overlay).
>
> **Bundled themes.** Alongside `builtin:dark` / `builtin:light`, the registry ships
> **Retrowave Neon**, **Nord**, **Solarized Dark** and **Solarized Light** as
> built-ins (undeletable). The shipped default preference is **mode `dark` with
> Retrowave Neon in the dark slot**, so a fresh install wears the retrowave palette;
> the light slot stays the built-in light palette for `auto` / `light`. The bundled
> ids/names/bases are mirrored in `src-tauri/src/themes.rs` (`BUILTIN_THEMES`) for the
> headless MCP surface.

## M11.A — Chart polish ✅

A follow-on pass over the analyzer charts: each **data type** gets a rendering chosen
for its semantics, and controls that were numbers become what they depict. Registry-
driven throughout — no per-tool chart components.

- **Series families.** The generic `SeriesView` gained declarative fields (`style` /
  `yScale` / `yRange` / `reference` / `semitoneGrid`) set per registry entry, so a
  scalar-over-time tool draws as a **line**, **area**, **step**, or **impulse
  (stems)**; pitch tracks use a **log-frequency y-axis with a semitone grid**; bounded
  ratios fix `0…1`; momentary loudness carries a **−14 LUFS reference line**.
- **Waveform dB scale.** A per-tool **dB scale** toggle collapses the min/max envelope
  to a single |peak| curve in dBFS (0 dBFS at the top) with a 0 dBFS reference line.
- **Spectrum log axis.** A per-tool **Log frequency** toggle (default on) switches the
  frequency axis between linear and logarithmic (octave) spacing.
- **Spectrogram contours.** Per-tool **Centroid** / **Rolloff** toggles (default on)
  overlay the spectral centroid and rolloff tracks, derived from the displayed
  magnitudes so they align with the heatmap's frames.
- **Chromagram note grid.** The chromagram draws pitch-class row rules with an
  emphasised octave (C) boundary.
- **Tempogram.** The tempo / downbeats tabs add a **tempo-salience** panel — the
  autocorrelation of the onset-strength envelope over the BPM range, with the chosen
  tempo marked — derived in the frontend from the returned envelope (no new analysis).
- **Level meters.** The `levels` tool draws **peak / RMS meter bars** (dBFS scale with
  a peak-hold marker) above its numeric cards.

> **Theme-aware.** The overlays are `ChartTheme` roles, so a theme drives them: the three
> new fields `reference`, `overlayCentroid`, `overlayRolloff` default in the dark/light
> base palettes (as do `select`, the drag-zoom tint, and the rhythm markers
> `markerOnset` / `markerBeat` / `markerDownbeat`, which used to be hardcoded per base);
> the meter colours are the CSS custom properties `--meter-low/mid/high/peak/unlit`. See
> [`theming.md`](theming.md).
>
> **Cursor and overlay legibility.** A chart can carry several marks at once, so every
> bundled theme holds each role at a hue of its own — previously `reference` was the
> *same* colour as the playhead in the dark/light bases, the retrowave `mirror` was the
> same pink as its playhead, and the mirror was the same blue as a beat marker in both
> bases. uPlot's own crosshair and drag-select are now themed too (derived to
> `--chart-hover` / `--chart-select`; its stylesheet is the only place they can be set),
> and marks drawn over a heatmap get a background-coloured **halo** so they read against
> any band of the ramp.
>
> **Delivered:** `SeriesView` + `seriesPlugins.ts` (reference line, semitone grid);
> `WaveformTab` (dB), `SpectrumTab` (log axis), `SpectrogramTab` (contours),
> `MatrixView` (note grid), `RhythmView` (tempogram), `ReadoutsView` +
> `LevelMeters.tsx`; the shared axis formatters now hide uPlot's `null` minor splits.

## M12 — Analysis exports: chart image + data (planned)

Save what an analyzer shows: the numbers (JSON / CSV) and the picture (PNG), built so
the same surface is reachable from the UI, MCP, and the batch CLI.

- **JSON** — the typed result wrapped in a **provenance envelope** (`kind`,
  `formatVersion`, `tool`, `generatedAt`, `source`, `window`, `params`, `options`,
  `result`), so a file is self-describing and reproducible.
- **CSV** — data only, **wide matrix** for the 2D tools (rows = time frames, columns =
  bins, header = frequencies / band indices); an optional `.meta.json` sidecar carries
  the provenance.
- **Chart PNG** — capture the **rendered** canvas (uPlot instance / the canvas views via
  a registry), 2× DPR, so the image matches the theme and zoom. GUI-only.
- **Where** — a per-tab **Export** popover (JSON / CSV / PNG + copy-to-clipboard),
  **Export ▸** in the tab context menu, and **Export all open analyses…**.
- **Shared plumbing** — `pick_save_path` / `write_text` / `write_bytes`; one Rust CSV
  renderer shared by the UI, MCP (`export_analysis` / `export_chart` / `export_all`) and
  the CLI (`--format` / `--out`).

> **Decision (committed):** JSON is the full-fidelity, self-describing format; CSV is
> **wide-matrix** for 2D data; the image is a capture of the rendered chart (no
> DOM-screenshot dependency); data exports are headless-capable, the image is GUI-only.
See [`exports.md`](exports.md) (ADR-16).

## M13 — Analysis templates (planned)

A **template** is a named, source-less analysis preset — the same settings, tools,
graphs, and layout — reusable across sources, with the **window moved to fit** the new
source rather than pinned.

- **Payload** (`.heyltemplate`, JSON): `setup` (shared params, tool options, open tools,
  filter flag), optional `filterGraph` / `synthGraph`, optional `layout` (dockview + node
  positions), and a **window policy** — reusing the project's `AnalysisSetup` /
  `GraphSpec` types (no new schema). No audio, no source descriptor.
- **Window / view policies** — `fractional` (**default**), `absolute`, `full`,
  `fixedLength`; applied against the new source's duration and clamped.
- **Apply** — reuses `applySharedParams` / `loadGraph` / `restoreLayout` and the window
  setters; keeps the **no duplicate tab** rule; confirms when the project is dirty.
- **Storage + UI** — `<app config>/templates/`; Rust `list/read/write/delete/rename/
  import/export`; a Toolbar **Templates** popover and **File ▸ Templates**; plus
  **New project from template**.
- **Agent surface** — MCP `list_templates` / `apply_template` / `save_template` /
  `export_template` / `import_template`; CLI `--template` (the compute subset: shared
  params, options, filter graph, window policy).

> **Decision (committed):** templates are **source-agnostic JSON** (not the binary
> `.heyl` container), include the **graphs** and an **optional layout**, and decode their
> window with a policy so "same settings, different source" works. The compute subset is
> usable headless; the layout part is GUI-only. See [`templates.md`](templates.md)
> (ADR-17).

## M14 — Notes ✅

An **annotation layer** on the project: a **markdown** note attached to an audio
**time** (a point, optionally a span) and to the **analyzer chart** it was taken from,
carrying a **frozen snapshot** of that chart's values. Notes show on the Timeline, on
the chart they belong to, and — when **focused** — on every time-based chart; they live
in a **collapsible right panel** and are reachable from the UI, MCP, and the CLI.

- **`Note` model.** `id`, `createdMs` / `updatedMs`, `timeSecs` (the anchor) + optional
  `range`, `tool` (the analyzer id; absent = a Timeline note), optional plain-text
  `title`, the **markdown** `body`, and a `values` snapshot. Serde + `ts_rs::TS`.
- **Values snapshot.** The chart's readout at the note's time (per-frame for a
  time-axis chart, the summary for a no-time-axis tool), **frozen** with its
  `window` / `params` / `options` provenance. A row shows the chart's **current**
  readout with the frozen one struck through beneath when they differ; editing the note
  or releasing a drag refreshes it. (No Recompute button, and no stale tag.)
- **Markdown.** Raw markdown body, sanitized render, edited in a textarea that an
  **explicit save** commits (Done / ⌘↵; Escape discards) — blur never saves, and the
  editor **replaces** the rendered body while it is open.
- **Notes panel (right rail).** A new **fixed region** (not a Workbench tab), hidden by
  default, toggled by a Toolbar `note-sticky` button (its count a muted pill *inside*
  the button while the rail is closed), resizable (clamped 160–520 px); open/closed +
  width persisted app-level. Compact rows sorted by time, each a **title bar** (heading
  + icon-only actions) over the meta, the values line, and the clamped body; select =
  focus. A note **pops out into its own window** (`open_note_window`, a real Tauri
  window like a tool popout, raised not duplicated).
- **Surfacing.** Every note an anchor in a thin **strip along the bottom** of the
  Timeline; a chart draws **its own** notes in its strip; the **focused** note draws as
  a full-height rule with a label on **every time-based chart** (the `time` sync group)
  but **not** on the frequency-axis `spectrum`. Focusing a note **opens/raises its
  chart** and sets the analysis window to the note's time.
- **Ranges are selections.** A range note shows a **handle on each edge** in the note
  lane and either end is draggable (never collapsing the span); a point note has one
  handle, which moves it. The panel's `Add` makes a point note; a **range** is made by
  dragging a span in the lane (there is no range toggle — the span *is* the toggle).
- **Source-second axes.** The engine re-bases every result onto source seconds
  (`windowStart` records the origin), so a chart's axis, its hover readout, and a note's
  `timeSecs` share one timebase whatever the analysis window is — the fix for notes
  drifting when the window moved.
- **Persistence.** A new **`NOTES` section (`0x07`, postcard)** in the `.heyl` container;
  notes ride `save_project` / `load_project`. Cross-window sync via `uiState`
  (`notes` + `focusedNoteId`); note edits mark the project dirty and are one undo step.
- **Agent surface.** MCP `list_notes` / `get_note` / `create_note` / `update_note` /
  `delete_note` / `set_focused_note` (app-only; headless has no project) and the notes in
  `get_state`; CLI `hey-listen notes <FILE.heyl>` (read-only, table or `--json`).

> **Decision (committed):** a note is **project content** anchored to a **time** and,
> optionally, to an **analyzer tool id** — not a Workbench tab, not an analyzer result.
> Its subtitle is a **frozen** values snapshot (refreshed on edit / drag-release), and the
> panel is **chrome** (a fixed region, view-persisted) while the notes themselves are
> **data** (project-persisted). See [`notes.md`](notes.md) (ADR-18).

### M14 follow-up — review fixes, the notes interaction model, and the preview transport ✅

A pass over the notes layer after using it, plus the transport facilities the notes
wanted. Reviewed behaviour is recorded in ADR-19 and [`notes.md`](notes.md).

- **A note is selected, not focused** (ADR-19). Selecting — the row's heading, its chart
  action, or a lane handle — highlights the note and opens/raises its chart but **never
  moves the analysis window**; a new row **Analyze** action (on point *and* range notes) is
  the only thing that reframes (a range becomes the window exactly; a point gets a window
  of the current width). This was the "clicking a note jumps there" / "adding a note moves
  the window" report.
- **Closing the rail unfocuses.** The focused note was a panel concept all along, so a
  closed rail drops the focus — clearing every chart's full-height overlay and the
  Timeline's stem — while the lane anchors stay, drawn **dull** (`panelOpen` rides the
  notes bus message).
- **Varispeed preview.** `preview_region` takes a `speed` (clamped 0.25×–4×, baked in by
  resampling the region, so it shifts pitch); the transport drives it with a **log slider**
  (`lib/previewSpeed.ts`, 1× at the centre). Preview only — analysis is always 1×. Also on
  the MCP `preview` verb.
- **The playhead on every time chart.** The transport's position rides the shared chart
  bus (`playhead`), drawn as a solid rule by `syncPlugins.playheadRule` (uPlot) and
  `chartCanvas.drawPlayhead` (canvas heatmaps) — what is being auditioned is visible on the
  data, not only on the Timeline. And **note at the playhead** in the transport, so an
  observation made while listening lands on the right moment.
- **Bug: the chart playhead froze at its first position.** The rule appeared but never
  moved or erased. Two causes, both silent: a plugin-driven repaint used `u.redraw(false)`,
  which only `commit()`s and so repaints nothing unless a scale change happens to be
  pending (uPlot documents `redraw()` as `setScale('x', …)`), and the transport watcher
  tracked the bus **key** while `setData` *merges* an object into an existing key — so only
  the message's **fields** notify, and the listener fired once and went deaf. `redraw()`
  is now used everywhere a plugin repaints, and the watcher reads `playhead.secs`.
  Covered by the `q-transport` playhead cases.
- **Bug: only the canvas charts followed a cursor mirrored from the other window.** With the
  spectrogram popped out and a uPlot chart in `main`, the popout's hover reached the heatmap
  but the chart drew the mirrored rule **once** — at the position it had at that moment —
  and then froze. The repaint watcher returned early on the message's **tag** (`group` /
  `sourceId`, constant for one publisher), and a Solid effect keeps only the dependencies
  **its last run** read: after the early return the cursor position was no longer tracked, so
  later moves changed nothing. The canvas painter was immune only because it reads the
  position *while drawing*. A `readBusMessage` helper (`state/chartSync.ts`) now reads every
  field of a bus message in every run — and hands back a snapshot so a caller cannot
  half-read it again — and every consumer of an object-valued key goes through it. The
  sibling of the `playhead.secs` trap above; covered by `o-cursor-sync.spec.ts` (a **second**
  remote move must move the mirror again).
- **Bug: notes never worked on the matrix tools** (mel spectrogram, MFCC, chromagram,
  spectral contrast). `valuesText` classified a result by testing `"times" in result`
  first, but a `MatrixResult` carries `times` **as well as** `bins`/`values`, so every
  matrix tool took the series branch, called the matrix view config's missing `formatY`,
  and threw inside `createNote` — the note was silently dropped. The classification now
  tests the band shape first, and `captureValues` catches a formatter failure so a readout
  problem can never lose the note.
- **Bug: the chart view went stale when the analysis window moved.** The visible time
  range was clamped into the new window instead of re-fitting it (and the uPlot charts
  re-applied the stale range after every `setData`), so a chart kept showing the previous
  window until the user zoomed. The window **is** a chart's x extent: moving it now clears
  the shared view (`chartSync`) and each chart re-fits.
- **Bug: tool-param switches did not respond.** The row was a `<label>`, so a click on
  Kobalte's `Switch.Control` fired *both* the control's own toggle and the label's implicit
  forwarding to the hidden checkbox — two toggles, no visible change (the spectrogram's
  Centroid / Rolloff being the obvious victims). The row is a `div` now, like the working
  shared-params switch; covered by an e2e regression test.
- **Bug: the hovered cursor did not cross windows.** The shared cursor was published on the
  in-process bus only — `uiState` carried the timeline, params, options, notes and views,
  but never the cursor. It now rides `cursor:${group}` (per sync group, so a frequency
  cursor cannot land on a time chart).
- **Bug: dragging the analysis window could stop the app responding.** The drag path did far
  too much per pointermove: it pushed the project's shared UI state (the window, the
  timeline view, …), and the core broadcast every push to the project's other windows,
  whose handlers re-ran effects and repainted; each move also re-fit **and fully repainted
  every open chart**, and took a whole-project snapshot (`layoutJson` → dockview's
  `toJSON` plus deep clones) for undo, while the window's two ends were written as two
  separate reactive transactions. With a popout open (a split Workbench of spectral charts
  and a couple of notes) that queued cross-window work faster than it drained, so the
  window moved a little and then the app stopped responding. Three changes: a UI-state push
  is **coalesced** (`uiSync.ts` — the leading value at once, then at most one per 60 ms,
  always the latest, so another window still follows a drag), the window's ends are written
  in one `batch`, and the shared-view reset that re-fits the charts is **debounced to the
  settle** (the data a chart re-fits to only arrives with the debounced analysis, ~200 ms
  later). The drag is back to ~3 ms per move, and `g-timeline.spec.ts` → G5 asserts the
  coalescing.

> **Delivered:** the notes interaction model (ADR-19), the varispeed slider and playhead
> transport, and the seven bug fixes above. See [`notes.md`](notes.md),
> [`architecture.md`](architecture.md) → Playback, and `e2e/specs/` (`d-analyzers`,
> `g-timeline` → G4 / G5, `n-notes`, `o-cursor-sync`, `p-notes-interactions`,
> `q-transport`).

## M15 — Code hygiene ✅

A **quality gate** so the invariants above stop being aspirations: files stay short
enough to read, logic is not copy-pasted, nothing dead is left behind, and both
languages are formatted and linted the same way. Delivered in three phases, and the
**gate came first** — reworking ~37 000 lines with nothing to catch a mistake is how
a refactor turns into a rewrite.

**Phase 1 — the gate ✅.**
- **One command.** `npm run maid` (check) / `npm run maid:fix` (fix) across six
  checks: prettier, eslint (+ `eslint-plugin-solid`), a **400-line file budget**,
  jscpd duplication, knip dead code, and `cargo fmt` + `cargo clippy -D warnings`.
  See [`code-hygiene.md`](code-hygiene.md).
- **Blocking hooks.** `.husky/pre-commit` (fast, staged files) and `.husky/pre-push`
  (the whole gate), installed by `npm install` through the `prepare` script.
- **CI.** The frontend job runs the five frontend checks; the rust job runs fmt +
  clippy on all three OSes and `cargo test` on Linux — which doubles as the
  **`src/bindings/` drift check** (ts-rs rewrites it during the run, and an
  uncommitted diff fails the job).
- **Ratchets, not snapshots.** The file budget can only shrink, the duplication
  threshold sits just above today's measurement, and knip's `ignoreIssues` is an
  explicit burn-down worklist with a grep-verified reason per file. Nothing was
  silenced by loosening a rule.
- **First pass.** prettier reformatted 61 files in one commit; eslint surfaced 46
  errors / 23 warnings — including three real Solid bugs (`solid/components-return-once`)
  and a missing `src-tauri/target` ignore that had eslint parsing generated JS — and
  `rustfmt` touched a single Rust file (the core was already clippy-clean).

**Phase 2 — split the long files ✅.** All 24 budgeted files are now directory modules
or thin aggregators, every file is under the 400-line ceiling, and
`scripts/maid-baseline/fileSizes.json` is **empty**. In order, biggest and safest
first, one file per change, no behaviour change, gate green after each:
- `src/App.css` (3066) → `src/styles/*` (15 stylesheets; `App.css` is now the
  `@import` aggregator, so its two importers are unchanged).
- `src/lib/graph.ts` (1268, ~920 of it one data literal) → `src/lib/graph/`
  (`types` / `params` / `kinds/*` / `palette` / `ports` / `spec`, behind a barrel
  `index.ts`, so `../lib/graph` still resolves).
- `src-tauri/src/audio/analysis.rs` (1650) → `audio/analysis/{mod,types,results,
  support,tools/*,tests}`; then `cli/batch.rs` (1264), `audio/graph.rs` (1117),
  `mcp/dispatch.rs` (859), `mcp/tools.rs` (474), `audio/playback.rs` (439) and
  `audio/capture.rs` (414) → the same `{mod, part}` shape.
- the frontend stores → `state/{analyzer,themes,project,mcp,notes,capture}/`, and
  `components/{Timeline,GraphEditor,Toolbar,NotesPanel,SourcePanel}.tsx` → sibling
  directories.

Inline `#[cfg(test)] mod tests` moved to sibling files as each module split. The one
visible knock-on was a generated binding comment (`src/bindings/SharedParams.ts`),
re-emitted by `cargo test` because an intra-doc link now points at the moved helper.

**Phase 3 — dedupe and delete ✅.** The four named duplications are gone:
- the analyzer pan / zoom / note-drag / reframe interaction (`SpectrogramTab` ↔
  `MatrixView` — the repo's largest at 17 clone pairs) → one
  `components/analyzer/chartInteraction.ts` (over shared `chartGeometry` /
  `chartCanvas`);
- the three-way select trigger (`ChannelSelect` / `SelectField` / `SourcePanel`) →
  one `components/SelectTrigger.tsx`;
- the unit-test harness (`notes.test.ts` ↔ `themeFile.test.ts`) →
  `scripts/testHarness.ts`;
- the triplicated splitter handlers in `App.tsx` → `lib/splitter.ts` +
  `components/Splitter.tsx`.

knip's `ignoreIssues` burn-down list was worked to **empty** (~15 unreferenced
symbols deleted), and **both ratchets were tightened**: the file budget to empty and
the jscpd threshold from **1.5 to 0.5** (measured ≈0.36 %).

> **Decision (committed):** hygiene is enforced by a **gate**, not by review. Checks
> are blocking (no advisory mode), the baselines are **ratchets that only tighten**,
> and the one-time formatting churn is isolated in a single commit so later diffs stay
> readable.

## M16–M20 — Analysis depth I ✅

Five milestones that close the analysis gaps found while driving the app through MCP on
a bioacoustic session: pitch range, amplitude envelope, note segmentation and per-note
level, voice-quality proxies, and AM/FM modulation spectra. They are independent of
M12/M13 and can be scheduled after them. Dependency order: **M16 → M17 → M18 → M19**;
M20 needs M16 + M17 and can ship after M19. The design, result shapes, option defaults,
and test plan live in [`analysis-metrics.md`](analysis-metrics.md).

## M16 — Pitch range + analyzer option integrity ✅

Make an f0 range actually reach the pitch tools, and stop unknown option keys from
silently doing nothing.

- **Per-tool f0 range.** Add `minF0Hz` / `maxF0Hz` to every pitch-related tool (YIN,
  autocorrelation, harmonic ratio, and the new note / modulation tools). `pitchYin` uses
  `PitchTracker::with_range`; the other two already accept the range. No new
  `SharedParams` field: the project file is `postcard`-encoded, so that would need a
  format bump. `freqMinHz` / `freqMaxHz` stays a **spectral band limit**, and the docs /
  shared-params tooltip are corrected accordingly.
- **Honest effective range.** Add `effectiveMinF0Hz` / `effectiveMaxF0Hz` to
  `PitchResult`; pYIN reports its fixed **50–2000 Hz** window intersected with the
  request.
- **Option integrity.** Accept camelCase plus snake_case aliases, reject unknown keys in
  the GUI path as the headless path already does, fix the snake_case examples in the
  `set_tool_options` description, and expose option metadata from the catalog (compact
  keys/defaults in `list_analyzers`, full detail in M21's `get_analyzer`).
- **Defaults.** Align `harmonicRatio` with the intended wide range (proposed 50–4000).
- **Upstream, not here.** pYIN's range is hardcoded to 50–2000 Hz in `oxiaudio 0.2.1`;
  above 2 kHz use YIN/autocorrelation. No local DSP fork.
- **Tests.** 75 Hz and 3 kHz detection, harmonic ratio at 3 kHz, per-tool range reaches
  the detector, aliases, unknown-key rejection.

> **MCP ownership:** M16 builds the generic option mechanism (key validation/aliases,
> catalog option metadata, effective-range reporting). M17–M20 each add their analyzer's
> catalog entry, option metadata, `includeData` note, and CLI `-o` keys. **M21** owns the
> cross-cutting summary / compact / annotation contract.

> **Delivered:** per-tool `minF0Hz`/`maxF0Hz` reach YIN, autocorrelation, and harmonic
> ratio (YIN via `PitchTracker::with_range`); harmonic-ratio defaults widened to
> 50–4000 Hz; `PitchResult` reports `effectiveMinF0Hz`/`effectiveMaxF0Hz` (pYIN's fixed
> 50–2000 Hz window is now visible in the chart and its empty-state copy); option keys are
> canonical camelCase with snake_case aliases and **unknown keys fail** in the GUI MCP
> path, the headless dispatcher, and the CLI; `list_analyzers` carries each tool's compact
> option keys/defaults. Tests: 75 Hz and 3 kHz detection, harmonic ratio at 3 kHz, pYIN's
> range, aliases, unknown-key rejection, and the spectral band not affecting a pitch
> search.

> See [`analysis-metrics.md`](analysis-metrics.md) → M16.

## M17 — Frame-RMS amplitude envelope ✅

A plain amplitude envelope, independent of LUFS.

- New **`frameRms`** analyzer (Time domain): frame-centred RMS in dBFS, with `frameMs`
  (10) / `hopMs` (5).
- Returns a `SeriesResult` (extended with an optional `frameSize`), so the existing
  series chart and readouts render it with no new component.
- Available through the GUI, headless MCP, and `hey-listen analyze`.
- **Not** `loudnessMomentary`: that stays EBU R128 and is unsuitable for short windows.
- **Tests.** Sine level in dBFS, silence floor, sub-frame window, echoed frame/hop.

> **Delivered:** a `frameRms` analyzer under **Time domain** returns frame-centred RMS
> in dBFS at a 10 ms frame / 5 ms hop by default, with `frameMs` / `hopMs` as per-tool
> options (canonical camelCase plus snake_case aliases). `SeriesResult` gained an
> optional `frameSize` (samples), so the result is self-describing and the existing
> series chart / readouts render it unchanged; the readouts add a **Frame** card when
> present. The catalog entry, option metadata, and `-o` keys ship with it, so the tool
> works in the GUI, the headless MCP server, and `hey-listen analyze`.
>
> Tests: a half-scale sine reads ≈ −9 dBFS per frame, a silent frame floors at
> −120 dBFS, a sub-frame window still yields one value, the configured frame/hop are
> echoed in samples (engine and headless MCP), and the snake_case aliases parse.

> See [`analysis-metrics.md`](analysis-metrics.md) → M17.

## M18 — Note segmentation, gaps, and per-note level ✅

Explicit notes, ends, gaps, counts, and levels.

- New **`noteMetrics`** analyzer: frame RMS (default 10 ms / 5 ms hop), gate it
  (absolute floor + threshold relative to the window peak + hysteresis), merge short
  gaps, drop short notes.
- Result: per-note start/end/duration, gap before/after, RMS/peak dBFS, level relative
  to the loudest note, and 5–7 normalized envelope points. Summary: note/gap counts,
  total and longest gap, median note/gap duration, the reference note, and the threshold
  used. Gaps are also returned explicitly.
- New **`noteMetrics` table view** (summary cards + scrollable per-note table).
- **MCP note:** `includeData: true` reads the note records; the compacted result keeps
  the summary counts so an agent knows what to request.
- **Tests.** Tone → gap → tone (2 notes, 1 gap), continuous tone (1 note, 0 gaps), short
  gap merge, relative levels, silent input.

> **Delivered:** `noteMetrics` (Pitch / melody) returns the note records, explicit gaps,
> the summary counts/medians, the gate used, and a 7-point normalized envelope per note.
> The **Note segments** view renders summary cards, a **segment chart** over the
> analysis window (each note as a peak/RMS block over its envelope, a voiced-share
> ruler, gap bands with durations, the gate, numbered notes, and a per-note f0 overlay
> on a right-hand axis; hovering a note highlights its table row), and a scrollable
> per-note table; the catalog entry and option metadata make it available in the GUI,
> headless MCP, and `hey-listen analyze`, and times are re-based onto source seconds
> like every result. Tests: `audio::analysis::tests::note_metrics`, the catalog default
> checks, and the headless option/result flow.
>
> **Terminology:** these are **detected audio notes**, distinct from the project's
> user-authored **annotations** (M14, stored as `Note`). The right rail is now labelled
> **Annotations** in the UI; the data model and MCP/CLI names are unchanged for
> compatibility. See [`notes.md`](notes.md) → Terminology.

> See [`analysis-metrics.md`](analysis-metrics.md) → M18.

## M19 — Note voice-quality proxies ✅

Per-note jitter, shimmer, and HNR proxies, built on the M18 segments.

- **Jitter proxy:** range-limited YIN f0 inside the note → cents → linear detrend →
  population standard deviation of the residual. YIN, not pYIN: pYIN's semitone bins
  would impose a large quantization floor.
- **Shimmer proxy:** population standard deviation of the note's frame RMS in dB.
- **HNR proxy:** mean `harmonic_ratio` over the note (0–1). Label it as the
  autocorrelation periodicity proxy, not HNR in dB.
- Also report `voicedFraction` and `f0MedianHz`; too few voiced frames yield `null`
  proxies rather than misleading numbers.
- **Tests.** Constant note ≈ zero jitter/shimmer; vibrato raises jitter; AM raises
  shimmer; noise lowers the HNR proxy; short notes return `null`.

> **Delivered:** `noteMetrics` gives every note its own fine YIN pitch grid
> (`pitchFrameMs` 40 / `pitchHopMs` 5, raised to ~3 periods of `minF0Hz`) and adds
> `voicedFraction`, `f0MedianHz`, `jitterProxyCents` (population std of the linearly
> detrended f0-in-cents residual), `shimmerProxyDb` (population std of the note's frame
> RMS in dB), and `hnrProxy` (mean `harmonic_ratio`, 0–1). The HNR figure is labelled
> the **autocorrelation periodicity proxy**, not HNR in dB, and all five are described
> as proxies in the UI. The per-tool `minF0Hz` / `maxF0Hz` reach the proxy grid; notes
> with too few voiced / harmonic frames return `null` rather than a misleading number.
> The Note segments table shows the five columns, the segment chart's hover card shows
> the whole per-note record (span, gaps, RMS/peak, levels versus the loudest note,
> voiced, f0, jitter, shimmer, HNR proxy), and the catalog entry + option metadata make
> the pitch options available through the GUI, headless MCP, and `hey-listen analyze`
> (snake_case aliases included).
>
> Tests: a steady note has near-zero jitter/shimmer and a high HNR proxy; vibrato
> raises jitter; AM raises shimmer; noise lowers the HNR proxy; a short note returns
> null pitch-derived proxies; the pitch option aliases parse (engine and headless).

> See [`analysis-metrics.md`](analysis-metrics.md) → M19.

## M20 — AM/FM modulation spectra ✅

Full modulation spectra, not a single rate: slow breathing and a fast trill can coexist.

- New **`modulation`** analyzer (Spectral).
- **AM:** frame-RMS envelope → detrend → Hann → zero-padded FFT over `modMinHz`–
  `modMaxHz` (0.5–100 Hz). Return the spectrum, the top peaks, the modulation index
  depth, and peak-to-trough dB.
- **FM:** range-limited YIN on the longest voiced run → cents → detrend → FFT on the
  same grid. Return the run span, the top peaks, and peak-to-peak / std depth in cents.
- New **`modulation` view** with both spectra and readouts; its own chart-sync group
  (`mod`), not the audio-frequency group.
- Clamp the modulation range to ~45% of the envelope sample rate to avoid aliasing.
- **MCP:** the top peaks and depths survive compaction; request the full spectra with
  `includeData`.

> **Tests.** 10 Hz AM, 3 Hz + 40 Hz AM, 30 Hz FM, no-voiced-run FM, alias clamping.

> **Delivered:** `modulation` (Spectral) returns two relative-dB spectra on one shared
> modulation-rate axis — the frame-RMS **AM** envelope and the longest voiced run's
> **FM** cents residual — plus each spectrum's ranked peaks (`topPeaks`, 3 by default),
> the AM depth and peak-to-trough range, and the FM run's span, top rate, peak-to-peak
> and standard deviation in cents. The range is clamped to ~45% of the lower of the two
> analysis rates and the **effective** range is reported, so aliasing is visible rather
> than silent. A spectrum is only reported when the modulation is meaningful (AM depth
> ≥ 2%, FM spread ≥ 2 cents), so a steady carrier stays blank instead of reporting an
> invented rate. The frame/hop, band, `detrend` (0 = mean only, 1 = linear), pitch grid,
> `minVoicedSecs`, and f0 range are per-tool options (camelCase plus snake_case aliases);
> the frame is capped at ~3 periods of the run's median f0 so a fast trill is not
> smeared. The new **AM/FM modulation** view draws both spectra on a modulation-rate
> axis with readouts, and syncs on its own `mod` group (not the audio-frequency one).
> Tests render real **synth graphs** through `graph::render_mono` — a sine carrier ×
> LFO multipliers for AM, and a control-driven all-pass delay (phase modulation) for
> FM — and cover 10 Hz AM, simultaneous 3 Hz + 40 Hz AM, a 30 Hz FM sweep, a steady
> carrier, silence, alias clamping, the aliases, the catalog defaults, and the headless
> `render_synth` → `modulation` flow.

> See [`analysis-metrics.md`](analysis-metrics.md) → M20.

> **Decision:** these are first-class analyzers, not MCP client-side math.
> No `SharedParams` fields are added (postcard compatibility); the pitch range is a
> per-tool option, and the shared frequency range stays spectral-only. pYIN's own range
> stays upstream. New results are not persisted yet, so no container change; the
> per-note measures are labelled as proxies.

## M21 — MCP + CLI analysis ergonomics (cross-cutting, planned)

Every analyzer call through MCP and the CLI becomes **compact by default, semantically
summarized, and discoverable**. The MCP catalog gains titles and annotations, and the
CLI gains per-analyzer discovery and a summary-only output mode. This is a cross-cutting
milestone over M16–M20, not another analyzer.

- **Canonical summary.** A Rust `ResultSummary` (a stable `text` line plus labelled,
  unit-bearing items) for every result family, computed from the full result before
  compaction. The MCP/CLI envelope gains `summary`; the GUI `run_analysis` returns
  `{ result, summary }`. `run_analysis` gains `summaryOnly` (summary without `result`),
  matching the CLI's `--summary`.
- **Compact by structure.** Matrices/spectrograms keep dimensions and peak
  time/freq/level; waveform/spectrum/series arrays keep meaningful stats; event and note
  arrays get a bounded preview instead of `{ length }`. `includeData: true` / `--full`
  still returns raw arrays.
- **Catalog annotations.** `title` + `annotations` (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`) for every MCP tool via a shared `ToolClass`;
  clearer `run_analysis` / `set_tool_options` descriptions; headless `get_state` reports
  per-tool option defaults.
- **New `get_analyzer`.** One analyzer's `about` (GUI) / description (headless), option
  metadata, and summary keys; `list_analyzers` stays the compact list. Option metadata
  comes from M16.
- **CLI discovery + output modes.** `analyzers <ID>` (human or JSON) explains options and
  summary keys; `analyze --summary` emits `{ file, window, params, options, summary }`
  without result arrays; `--summary` + `--full` is a usage error.
- **Tool-output audit.** `list_notes` defaults to a compact summary (body excerpt + values
  text; full body via `get_note` or `full: true`); `list_analyzers` stays compact with
  `get_analyzer` for detail; the other list tools are checked for bounded responses.
- **Consistency.** One Rust shaper builds the summary and the compact shape for every
  result family; the GUI MCP handler forwards `shape`/`maxPoints`, the analyzer tabs
  request `full`, and headless/CLI use the same function. The TS compactor is retired.
- **Tests.** Summary for every result variant (including empty/silent), compact golden
  fixtures, catalog title/annotation coverage, `get_analyzer`, CLI modes, and an
  agent/CLI end-to-end sequence.
- **Deferred.** Per-tool `outputSchema` (the result is a tagged union and the protocol
  version is client-negotiated), a configurable preview length, and "did you mean?"
  suggestions for unknown tools/options.

> **Scope:** M16 owns the generic option mechanism; M17–M20 own their analyzer's catalog
> entries; **M21 owns the shared summary/compact/annotation contract**. It depends on M16
> and can land before or after M17–M20. See
> [`mcp-cli-ergonomics.md`](mcp-cli-ergonomics.md).
