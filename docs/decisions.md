# Decisions (ADRs)

## ADR-1 — dockview for the Workbench

**Context:** analyzer tabs need docking/splitting, but only inside the central
region; the Timeline and Sidebar are fixed panes.

**Decision:** use `dockview` (framework-agnostic, zero-dep), mounted **only**
inside the Workbench. Timeline/Sidebar/Workbench are fixed Solid regions, not
dockview panels.

**Consequence:** docking/tab features are limited to the Workbench, which is
exactly the requirement. The Workbench hosts the **graph editors** (filter/synth,
ADR-10) and, from M4, the analyzer tabs.

## ADR-2 — Binary project file (postcard + raw PCM sections)

**Context:** the project file must be binary, embed raw audio, and perform well
for large audio.

**Decision:** single-file versioned container; structured data via `postcard`,
layout via `serde_json`, bulk PCM as a raw chunked `DATA` section.

**Consequence:** compact + streamable, but the format is hand-specified and must
be versioned carefully (see
[`project-file-format.md`](project-file-format.md)).

> **Implemented (M6):** `src-tauri/src/project/` reads/writes the container and
> `commands/project.rs` exposes `save_project` / `load_project`. The checksum is a
> CRC-32 (the doc's "xxHash/CRC") and `SOURCE` is a `kind`-tagged struct, since
> `postcard` cannot encode internally-tagged enums. `RESULTS` is written empty for
> now (result caching deferred) — see the format doc.

## ADR-3 — One window = one project

**Decision:** each Tauri window hosts one independent project; no shared state.

> A **popout** (M7) is not a second project window: it is a second *view* of one
> Workbench tab for the *same* project (see ADR-11 and `ui-layout.md`).
>
> **Implemented (M7):** the app runs **N independent project windows** — File →
> **New Window** (`open_project_window`) opens one. Each is a separate webview: its
> own frontend, and its own core state (`state::WindowRegistry`, keyed by window
> label). The core's per-project state (source PCM, filter graph, preview player,
> capture session, **shared UI state**) moved from a single app-managed value to that
> registry, resolved per command via `state::window_state(&window)`. App-wide stores
> (recent projects, pending open files) stay shared, and the File/Edit menu actions
> are emitted to the **focused** window.

## ADR-4 — PCM over `tauri::ipc::Channel`, not events

**Decision:** ordered, high-throughput audio streams use `Channel`; events are
reserved for status/signals.

## ADR-5 — fundsp for filtering/synthesis, oxiaudio for analysis

**Decision:** keep the audio *net* (filtering, synthesis) in fundsp and the
*analysis* in oxiaudio, to respect each crate's strengths.

## ADR-6 — Shared analysis params in the frontend store

**Decision:** shared params (FFT size, hop/overlap, randomized overlap, window
function, channel, frequency range) live in one Solid store and are sent with
each `run_analysis`, guaranteeing cross-tool sync. The store is
`src/state/analysis.ts` — the channel selection landed with the source work; the
rest arrives in M4.

## ADR-7 — Timeline waveform on a 2D canvas; preview via Web Audio

**Context:** the Timeline is a fixed region (not an analyzer tab) that renders
the whole waveform and overlays a draggable analysis window. Dragging a window
handle must audition that region.

**Decision:** render the waveform with the plain 2D canvas API rather than
solid-uplot — the Timeline needs custom range handles, a ruler, and zoom/pan that
would otherwise fight the chart abstraction. Rendering uses a per-source
min/max peak envelope (with a raw-sample fallback when zoomed in). Preview
playback is frontend-only via the Web Audio API, since the decoded PCM is already
in the WebView; Rust has no playback path.

**Consequence:** the Timeline stays independent of the analyzer charting stack
(solid-uplot remains for analyzer tabs in M4+). The full PCM is retained in the
frontend, which is fine for M1 but may need revisiting for very large files /
live capture.

> **Superseded in part by ADR-9 (M3):** preview playback and PCM ownership move
> into the Rust core.

## ADR-8 — Kobalte for accessible UI primitives

**Context:** the Source picker needs real form controls (comboboxes, selects) with
keyboard support, typeahead, focus management and correct ARIA wiring. Hand-rolling
these is error-prone.

**Decision:** use `@kobalte/core` (unstyled, accessible, composable SolidJS
primitives) for such controls, imported from per-component subpaths (e.g.
`@kobalte/core/combobox`). We style the parts ourselves via their `data-*` state
attributes; Kobalte ships no CSS.

**Consequence:** the Source picker and Timeline use Kobalte primitives: `Select`
(source kind), `Combobox` (device / application), `Slider` (gain), `NumberField`
(start/stop timers), `Meter` (input level) and `Button` (throughout). Popups are
portaled and positioned by Kobalte, so they escape the fixed Source panel and flip
above it; `Meter` exposes `--kb-meter-fill-width`, and `Slider` positions its
fill/thumb inline, so our CSS only supplies appearance. **Tabs are deliberately
not used:** the only tabs in the app are the Workbench tabs (the graph editors and
the analyzers) inside the Workbench, owned by `dockview` (ADR-1), so a Kobalte
`Tabs` region would violate that rule.
The vendor libraries push the bundle past Vite's 500 kB warning, so
`vite.config.ts` splits them into their own chunks (`dockview`, `kobalte`) with
`build.rolldownOptions.output.codeSplitting`; the app chunk itself stays small.

> **Implemented (M7):** pure numeric inputs (the Kobalte `NumberField`s, the graph
> nodes' inline params, and the synth length) gained **drag-to-adjust** — drag up to
> increase, down to decrease, Shift for fine control — alongside typing, via
> `src/lib/dragNumber.ts`. There is no slider; an `ns-resize` cursor is the only
> affordance (see `ui-layout.md`).

## ADR-9 — Move preview playback into the Rust core (cpal)

**Context:** ADR-7 keeps preview playback in the frontend (Web Audio) because the
decoded PCM is already in the WebView. That was a scoped M1 shortcut, and it
conflicts with "the Rust core owns all audio I/O" — playback *is* audio I/O. It
also diverges from analysis: from M3 the fundsp graph is applied in Rust *before*
analysis, so a frontend preview would play raw PCM while the analyzers see the
filtered signal. The channel selection already had to be duplicated once in JS
(`audio/playback.ts`) and once as the shared analysis param. The full PCM also
lives twice in the WebView (`Float32Array` + `AudioBuffer`) and grows unbounded
for live capture.

**Decision:** move preview playback into the Rust core over `cpal` (already in the
dependency tree via flexaudio's mic backend). Keep one output stream open and
drive it from a ring buffer with `play(region, loop)` / `stop` / `seek` / gain, so
interactive scrubbing pays neither stream-open nor IPC latency. PCM ownership
moves to the core: file sources are re-read/seeked (or cached) in Rust and live
capture retains its PCM in Rust; the WebView keeps only the peak envelope the
Timeline draws from.

**Consequence:** new commands (`preview_region`, `stop_preview`,
`set_output_gain`, `list_output_devices`) plus stream-error events, and the
frontend preview module (`src/audio/playback.ts`) goes away. Scheduled with M3,
the first point where "what you hear" must equal "what is analysed". Coupled to
the "where does the PCM live" question that the project file (M6, `DATA` section)
settles anyway.

> **Implemented (M3):** the core owns the source PCM (`state.rs`): `stream_file`
> caches the decode, `render_synth` caches the render, live capture appends while
> recording, and `clear_audio_source` drops it. `audio/playback.rs` keeps one
> `cpal` output stream open on a dedicated worker (the stream is `!Send` on macOS)
> and plays the region after mixdown → filter → resample; `audio/preview.ts`
> replaces the deleted Web Audio module. Because the core filters a region *when it
> is loaded*, the frontend re-issues the active preview whenever the filter graph,
> analysis channel, or output device changes — otherwise a filter edit would only
> be heard on the next preview.
>
> **Transitional deviation:** the frontend still retains a full PCM copy for the
> Timeline *waveform* (peaks + zoomed raw-sample fallback). ADR-9's "the WebView
> keeps only the peak envelope" needs Rust-side peak/LOD streaming and is deferred;
> until then the PCM exists twice (traced here deliberately).

## ADR-10 — The graph editors are Workbench tabs

**Context:** M3 adds two fundsp editors (filter and synth). They are not analyzer
*tools* (they produce no analysis result and are not in `analysis-tools.md`), yet
they are tabbed, dockable content that belongs next to the analyzers. ADR-1 (and
`ui-layout.md`) had said the Workbench hosts "analyzer tabs only".

**Decision:** the Workbench (`dockview`) hosts the **graph editors** as their own
panels/tabs — `filter` and `synth` — alongside the analyzer tabs arriving in M4.
The fixed-region rule is unchanged: Timeline, Sidebar, Source, and Workbench are
still regions, not tabs, and dockview is still mounted only in the Workbench.

**Consequence:** the Tab rule generalizes to "the only tabs are Workbench tabs",
which are the graph editors plus the analyzers. The Sidebar's tool list opens
both kinds; no duplicates (a tool is open at most once). Graph state lives at
module scope (`state/graph.ts`), so a closed/reopened tab keeps its graph.

**Graph model (mirrors fundsp `Net`):** the editor compiles to a literal
push + connect — `net.push` per node, `net.connect` per edge, with each input
taking exactly one source (a second connection to the same input is rejected in
the UI **and** the core). Explicit `input` / `output` anchor nodes bridge the
graph to the net's global input/output; a `mix` node sums two signals. What is
wired to `output` is exactly the graph's result — there is no implicit summing of
"terminal" nodes.

## ADR-11 — Project UI state lives in the core; windows are views

**Context:** a Workbench tab can be **popped out** into its own window (M7). Keeping
the project's UI state (timeline window/viewport, shared analysis params, per-tool
options and chart views, project name) in each window's JS made the popout a
*diverging copy*: zooming one chart, or moving the analysis window, did not reach the
other window, and the title was derived from a per-window source stub. The first cut
leaned on workarounds (a stub source, a one-way `load_shared_source`) instead of the
Tauri data-flow rules.

**Decision:** the project's **UI state lives in the Rust core** (`WindowState::ui`, a
key → JSON map; the frontend owns the shape). `get_ui_state` hands a window the whole
snapshot on load, `set_ui_state` stores a patch and **emits `ui-state` to the
project's other windows** (`WindowRegistry::project_windows`), and the frontend
bridge (`src/state/uiSync.ts` + `uiState.ts`) pulls on load, pushes local edits, and
applies remote patches. A popout is a **real Tauri window** whose label is
`WindowRegistry`-aliased to its parent, so every command resolves to the same
project state.

**Consequence:** windows are views of one state — timeline window, params, chart
zoom, and project name stay in sync automatically, and a popout reuses the parent's
source without copying PCM. Popouts are created only by Tauri/wry
(`open_popout_window`), never by `window.open`; the frontend just renders. A popped
tool is recorded in the project's `LAYOUT` and its window re-created on load, and a
project window closes its popouts when it closes. Because a popout is a view, not a
second tab, selecting a popped-out tool **raises** its window (`focus_popout`) rather
than opening a duplicate tab.

> The first popout attempt used dockview's `addPopoutGroup` (`window.open`). On macOS
> that popup must load `tauri://localhost/…` through the custom URL-scheme handler,
> which crashes (`WebURLSchemeHandlerCocoa::platformStartTask` → null mutex) because
> the popup webview is not a full wry webview. Only a native Tauri window sets the
> scheme handler up correctly — hence ADR-11.

## ADR-12 — MCP server in the app; a stdio bridge reaches it

**Context:** M9 exposes Hey Listen to AI agents over the Model Context Protocol. MCP
clients (Zed, …) launch a *local* server as a `command` + `args` and speak MCP over
its stdio. But the milestone requires **UI following**: the agent must drive — and
observe — the *running* project window, not a headless second copy of the app. A pure
stdio process cannot reach the app's live state or its webview.

**Decision:** the MCP **server runs inside the app process**. It binds an ephemeral
`127.0.0.1` port, advertises it (with a random token) in `mcp.json` under the app
data dir, and serves newline-delimited JSON-RPC. Each `tools/call` is forwarded to
the focused project window's frontend as the `mcp:request` event; the frontend runs
the tool against the same stores and `invoke` commands the UI uses and answers
through the `mcp_respond` command, which completes the server's waiting channel. The
`heylisten-mcp` binary (`heylisten-mcp`, or `hey-listen --mcp`) is a dumb
stdio ⇄ socket byte pump, so a standard MCP client still connects over stdio. The
tool **catalog** is static in the core (`tools/list` always answers); the tool
**handlers** live in the frontend (`src/state/mcp.ts`), so there is no second,
parallel execution path.

**Consequence:** an agent action is reflected in the live window and the window's
state is what the agent reads — UI following is automatic in both directions, and
any future UI capability is one handler away from being agent-accessible. The core
keeps the protocol/transport (unit-tested without Tauri); the frontend keeps the
orchestration. Costs: the app must be running (the bridge waits, then errors), one
instance per data dir (the advertised port is a single file), and file pickers /
project-loss prompts still belong to the UI (agent tools take a `replace` flag to
skip the replace-source prompt). No new crates — the server is `std::net` + `serde_json`.
See [`mcp.md`](mcp.md).

## ADR-13 — MCP control surface, headless CLI, and multi-project targeting

**Context:** ADR-12 made the agent drive the *running* window through a bridge, which
requires the app to be open. Three follow-up needs surface: a user-friendly way to
control the server from the UI (on/off, port, a copyable config), a way to use MCP
with **no GUI at all** (`heylisten-mcp` alone), and a way for an agent to reach a
*specific* project window rather than only the focused one. The goal is to serve all
three without a second, parallel implementation of the tools.

**Decision:**
- **Control surface.** A Toolbar **MCP** popover (default **off**, port default
  `47100`, free-port fallback, inline "port in use" error, live status, copyable
  snippet). Settings persist in `tauri-plugin-store` (read by the core in `setup`, so
  the server starts in the right state before any window), written only through
  `get_mcp_status`/`set_mcp_config`; the snippet is copied via
  `tauri-plugin-clipboard-manager`. `port_check` is not used — the bind is the check.
- **Headless CLI.** `heylisten-mcp` auto-detects: a running, enabled app → bridge
  (UI following); otherwise → a **core-native** MCP server over stdio (`--headless`
  forces this). The headless dispatcher reuses the **engine** (the same extracted
  functions the GUI commands call), so there is no second DSP path; UI-only tools
  (`open_tool`/`close_tool`, editor-layout graphs, `save_project`/`open_project`)
  answer "requires the app" in headless mode.
- **Multi-project.** `list_projects` + an optional `target` on every tool, so one
  port addresses any of a process's project windows (`main` / `project-*` / popouts);
  the focused window remains the default.

**Consequence:** the delivered frontend-executed path stays for the GUI (UI
following), while the headless path is a thin core-side adapter over shared engine
functions — the "same surface" is the engine + the `WindowState::ui` mirror, not the
frontend stores. Costs: headless `save`/`load` and editor-layout graph editing remain
GUI-only, and the headless subset is a second (thin) orchestration that must be kept
in step with the GUI handlers for the tools it covers. See [`mcp.md`](mcp.md).

**Status: implemented.** `McpController` (`mcp/settings.rs`) owns the persisted
config and a non-blocking accept loop it can stop/rebind; the Toolbar `McpPopover` is
a view over `get_mcp_status` / `set_mcp_config` (so the plugin store's lack of
cross-instance sync is moot); `mcp::run` auto-detects bridge vs headless and
`--headless` forces the latter; `list_projects` + `target` add multi-project
addressing. `tauri-plugin-cli` (not a hand-rolled parse) declares the app binary's
flags. One deferral stands: headless `preview`/`capture` are *not* wired (they are
real device I/O with no UI to configure them), so they answer "requires the app" —
the milestone's "filter/synth" headless scope is met by `run_analysis` over a file and
`render_synth` with an explicit graph.

## ADR-14 — Batch CLI (`heylisten-cli`) is a plain console binary over the engine session

**Context:** ADR-13 gave the app an MCP server and a headless stdio entry, but using
them from a **shell** means speaking JSON-RPC by hand — `initialize`, one JSON message
per call, `jq` — which is fine for an agent and tedious for a script (`docs/cli.md`).
Bulk analysis ("run these tools over these files, print the numbers") wants a real
command with flags. The question is where it lives: subcommands on the app binary
(`tauri-plugin-cli`, as `--mcp` uses) or a separate program.

**Decision:** a **third, plain console binary**, `heylisten-cli`, sibling of
`heylisten-mcp`.

- **Not the app binary.** `tauri-plugin-cli` needs a Tauri app context, so only the
  app binary can declare its flags — and the app binary starts the Tauri runtime and,
  in the Windows release, has **no console** to write to. A batch tool must print to
  stdout and run with no GUI, on a headless host and in CI. That is the same reasoning
  that already made `heylisten-mcp` a console binary. So the CLI parses its own
  arguments with `clap` (already in the tree via `tauri-plugin-cli`; the app binary
  keeps the plugin for `--mcp` / `--headless`).
- **One engine session, shared with headless MCP.** The headless session
  (`mcp/dispatch.rs::HeadlessSession`) is not MCP-specific — it is the engine facade
  (source PCM + shared params + tool options + window + preview-free `run_analysis`) —
  so it moves to a neutral `engine::Session` (`src/engine.rs`). Both the headless MCP
  server and the CLI drive it, and both reach `analysis::run_window` / `audio::decode`
  / `audio::graph`. The CLI is a thin `clap` front end that maps flags onto the same
  session operations; there is no third DSP path.
- **Compute subset only, and standalone.** The same subset as headless MCP (open a
  file, run analyzers, render a synth graph, list the catalog) — no UI-only tools, no
  device enumeration (which on macOS would touch the AudioUnit/permission path a batch
  tool must never trigger). Unlike `heylisten-mcp`, the CLI **never bridges** to a
  running app: a batch job must be deterministic and must not drive the user's window.
- **Output is JSONL**, a self-describing object per `file`/`tool` (the `run_analysis`
  shape plus `file`), compacted by default (`--full` for raw arrays), `--pretty` for a
  single result; exit `0`/`1`/`2`.

**Consequence:** bulk analysis and CI use a shell-native command over the exact engine
the GUI uses, with no app, no MCP client, and no window; `heylisten-mcp` stays the
agent path. Costs: a third binary to build and document, and one more thin front end
that must stay in step with the engine's operations (shared with the headless MCP
dispatcher, which mitigates it). `--filter` (a `GraphSpec` set before analysis) is the
one place the CLI is ahead of the MCP subset. See [`cli.md`](cli.md).

**Status: planned (M10).** Not yet implemented.
