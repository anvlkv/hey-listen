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
would otherwise fight the chart abstraction. Rendering uses a per-source **pyramid
of min/max envelopes** (a fine level for deep zooms, coarser levels up to the full
view, and a raw-sample fallback only when a column is narrower than the finest
bucket). A single base envelope left a pathological middle zoom: the raw fallback
scanned millions of samples per repaint for a 4-minute file, and the Timeline
repaints on every chart cursor move and transport tick. Preview playback is
frontend-only via the Web Audio API, since the decoded PCM is already in the
WebView; Rust has no playback path.

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
> recording, and `clear_audio_source` drops it. `audio/playback/` keeps one
> `cpal` output stream open on a dedicated worker (the stream is `!Send` on macOS)
> and plays the region after mixdown → filter → resample; `audio/preview.ts`
> replaces the deleted Web Audio module. Because the core filters a region *when it
> is loaded*, the frontend re-issues the active preview whenever the filter graph,
> analysis channel, or output device changes — otherwise a filter edit would only
> be heard on the next preview.
>
> **Transitional deviation:** the frontend still retains a full PCM copy for the
> Timeline *waveform* (the multi-resolution peak pyramid + a raw-sample fallback at
> extreme zoom). ADR-9's "the WebView keeps only the peak envelope" needs Rust-side
> peak/LOD streaming and is deferred; until then the PCM exists twice (traced here
> deliberately).

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
tool is recorded in the project's `LAYOUT` and its windows reconciled on load
(`sync_popouts`: one window per recorded tool, extras and duplicates closed), and a
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
**handlers** live in the frontend (`src/state/mcp/`), so there is no second,
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

## ADR-14 — Batch CLI is the app binary, run windowless via `tauri-plugin-cli`

**Context:** ADR-13 gave the app an MCP server and a headless stdio entry, but using
them from a **shell** means speaking JSON-RPC by hand — `initialize`, one JSON message
per call, `jq` — which is fine for an agent and tedious for a script (`docs/cli.md`).
Bulk analysis ("run these tools over these files, print the numbers") wants a real
command with flags. The question is where it lives: subcommands on the app binary
(declared with `tauri-plugin-cli`, as `--mcp` already is) or a separate program.

**Decision:** the CLI is a **subcommand of the app binary**, declared in
`tauri.conf.json` → `plugins.cli` and parsed by `tauri-plugin-cli`. **No third binary,
no hand-rolled parser.**

- **The plugin decides it.** `tauri-plugin-cli` reads its definition from the app
  context (`app.cli().matches()` → `Cli`), and `Cli` cannot be constructed outside the
  plugin, so only a process that builds a Tauri app can use it. That process is the app
  binary — the same one that already takes `--mcp` / `--headless`. Using the plugin is
  the project's single source of truth for the interface and keeps one vocabulary with
  the existing flags.
- **Windowless, like `--mcp`.** `setup` resolves the entry (`--mcp` → the MCP stdio
  entry; a subcommand → the batch command; neither → the GUI). The batch command
  prints JSON and exits **before any window is created**, so it never opens, shows, or
  drives a window — no webview, no IPC, no UI following. The main window is
  `"create": false`, so nothing exists on this path.
- **One engine session, shared with headless MCP.** The batch command maps the matched
  args onto the same operations the headless MCP server runs (`open_audio_file`,
  `run_analysis`, `set_shared_params`, `set_tool_options`, `render_synth`,
  `list_analyzers`) through the one shared headless session, and both reach
  `analysis::run_window` / `audio::decode` / `audio::graph`. There is no third DSP path.
  Analyzer ids are validated against `audio/analyzers.rs` rather than enumerated in the
  config (which would duplicate the catalog in JSON).
- **Compute subset only, and standalone.** The same subset as headless MCP (open a
  file, run analyzers, render a synth graph, list the catalog) — no UI-only tools, no
  device enumeration (which on macOS would touch the AudioUnit/permission path a batch
  tool must never trigger). Unlike `heylisten-mcp`, the CLI **never bridges** to a
  running app: a batch job must be deterministic and must not drive the user's window.
- **Output is JSONL**, a self-describing object per `file`/`tool` (the `run_analysis`
  shape plus `file`), compacted by default (`--full` for raw arrays), `--pretty` for a
  single result; exit `0`/`1`/`2`. Usage errors must print and exit `2` rather than fall
  through to launching the GUI (the `.heyl` file-open path keeps the current
  "unparseable → GUI" behaviour).

**Consequence:** bulk analysis and CI get a shell-native command over the exact engine
the GUI uses, with no window and no MCP client, and `heylisten-mcp` stays the agent path.
Costs: the interface must live in `plugins.cli` (so the argument schema is JSON, not
Rust), the CLI shares the app binary's platform requirements — on **Windows** the app
binary has no console, and a **bare GUI-less host** cannot start a Tauri app at all
(that case stays `heylisten-mcp --headless`) — and it is one more thin front end to keep
in step with the engine (mitigated by sharing the headless session). `--filter` (a
`GraphSpec` set before analysis) is the same headless `set_filter_graph` tool the MCP
server exposes — the CLI takes the graph directly, as does headless `render_synth`.
See [`cli.md`](cli.md).

**Status: delivered (M10).** See [`cli.md`](cli.md); the batch logic lives in
`src-tauri/src/cli/batch/`.

## ADR-15 — Themes are data: a `ThemeFile` over a built-in base, resolved by slots

**Context:** the app ships a fixed auto/dark/light theme, with the palette authored in
**four** places (the `--*` custom properties in `src/styles/`, the `ChartTheme` in
`state/settings.ts`, the heatmap ramps in `colormap.ts`, and the dockview / `solid-flow`
themes). Shipping *exchangeable* themes means a theme must be able to drive all four,
but restating ~70 CSS variables in every theme would duplicate the palette and break
whenever a variable is added.

**Decision:** a theme is a **`ThemeFile`** (`.heyltheme`, JSON) that **overlays a
declared `base`** (`dark` or `light`). The built-in dark and light become two full
`ThemeFile`s in the registry (`builtin:dark` / `builtin:light`, undeletable); a user
theme carries only what it changes (`ui` CSS vars, `chart` fields, a `colormap` ramp,
optional `flow` overrides). Applying sets `data-theme = base` (so `src/styles/`, dockview and
`solid-flow` supply the baseline), then writes the `ui` overlay as **inline custom
properties** on the root, merges `chart`, and swaps the colormap. The preference becomes
a **mode + two slots** (`darkThemeId` / `lightThemeId`); `auto` follows the OS to pick a
slot. Themes live in `<app config>/themes/`, mirroring `recent.rs`, with list / read /
write / delete / import / export commands; parsing/validation is frontend-owned (Rust
stores bytes), and an unknown key or newer version degrades gracefully instead of
failing.

**Consequence:** a theme is small, forward-compatible, and shareable; existing dark/
light keep working as the defaults, and `auto` gains a chosen dark and light theme. The
cost is a two-layer mental model (base + overlay) and a coarse fallback for dockview /
`solid-flow`, whose themes are opaque dark/light objects — a custom theme inherits the
base's chrome there unless it supplies `flow` overrides. Themes are app chrome, so they
are **not** stored in the project file. See [`theming.md`](theming.md).

**Status: delivered (M11).** Alongside `builtin:dark` / `builtin:light`, the registry
ships bundled **Retrowave Neon** (the shipped default, dark slot), **Nord**,
**Solarized Dark** and **Solarized Light**; the Rust store mirrors the bundled ids for
the headless MCP surface. See [`theming.md`](theming.md).

## ADR-16 — Exports are self-describing: JSON envelope, wide-matrix CSV, rendered PNG

**Context:** every analyzer computes a typed result, but it can only be *shown* — there
is no way to save the numbers or the picture, and a result on its own is not reproducible
without the window / params / source it ran against. The batch CLI already serialises
results to JSON (the MCP `run_analysis` shape) but the UI exports nothing.

**Decision:** each analyzer can export its **data** and its **chart**.

- **JSON** wraps the typed result in a **provenance envelope** (`kind`, `formatVersion`,
  `tool`, `generatedAt`, `source`, `window`, `params`, `options`, `result`) so a file is
  self-describing and reproducible from a source + a template.
- **CSV is data only** and, for the 2D results, a **wide matrix** (rows = time frames,
  columns = bins, header row = frequencies / band indices), matching what a
  spreadsheet / `pandas` user expects; an optional `.meta.json` sidecar carries the
  provenance.
- **Chart images** capture the **rendered** canvas (uPlot instance / the canvas views via
  a small registry) rather than re-rendering, at 2× DPR — so the PNG matches the user's
  theme and zoom. A DOM-screenshot dependency is avoided.
- The data exports are **headless-capable** (MCP `export_analysis`, CLI `--format` /
  `--out`), sharing one CSV renderer in Rust so both paths are byte-identical; the image
export needs the rendered canvas and is **GUI-only** (`export_chart` answers "requires the
app").

**Consequence:** results become portable and reproducible across the UI, MCP and the
batch CLI, with one serialisation rule instead of three. Costs: the CSV renderer must be
kept in step between the Rust (headless/CLI) and frontend (UI) paths, and very wide
matrices (high FFT / bin counts) are the format's nature, not a quirk. See
[`exports.md`](exports.md).

**Status: planned (M12).**

## ADR-17 — Templates are source-less JSON presets with a window policy

**Context:** the project file already stores the whole analysis setup (`SETUP`) and the
Workbench layout (`LAYOUT`) — but it also embeds the audio (`DATA`) and is a binary
container, so it cannot be reused as a preset for a *different* source. The user wants
"analyse different sources with the same settings, window and etc (window may move)".

**Decision:** a **template** is a `.heyltemplate` (JSON) holding the setup, the filter /
synth graphs, an **optional** Workbench layout, and a **window policy** — and **no audio
and no source descriptor**. It reuses the existing `AnalysisSetup` / `GraphSpec` types
(no new schema). Because it is source-agnostic, its window is interpreted against the
new source's duration via a policy: `fractional` (**default** — same relative region),
`absolute` (clamp), `full` (whole source), or `fixedLength` (keep length). Applying
reuses the project's restore path (`applySharedParams`, `loadGraph`, `restoreLayout`, the
window/view setters), keeps the no-duplicate-tab rule, and confirms when the project is
dirty. Templates live in `<app config>/templates/` (mirroring `recent.rs`) with list /
read / write / delete / import / export; the frontend assembles the payload and Rust
stores bytes. The **compute subset** (shared params, options, filter graph, window
policy) is exposed headless (MCP `*_template` tools, CLI `--template`); the layout part
is GUI-only.

**Consequence:** a setup is portable and diffable, reusable across sources, and
reproducible headless from a shell or an agent — pairing naturally with the export
envelope (a template + a source reproduces an exported result). Costs: window semantics
must be chosen per template (a policy, not a frozen span), and a template apply is a
destructive in-place edit of the current setup (guarded by a confirm). See
[`templates.md`](templates.md).

**Status: planned (M13).**

## ADR-18 — Notes are project content: a time + chart anchor with a frozen values snapshot

**Context:** the app can analyse audio from many angles but has no place to record an
*observation* — "the third harmonic spikes here", "this is a room reflection". Such a
remark is meaningful only next to the audio moment and the chart it was read off, and it
must survive the window / params moving on. It is neither an analyzer (it produces no
`AnalysisResult`) nor a Workbench tab (those are content, and the fixed-region rule keeps
non-tab chrome out of `dockview`).

**Decision:** add a **note** — a small serde payload anchored to an audio **time** (a
point, optionally a `range`) and to an optional **analyzer tool id** (absent = a
Timeline note), carrying a **markdown** body and a **frozen** `values` snapshot (the
chart's readout at that time, with its `window` / `params` / `options` provenance,
refreshed whenever the note is edited or dragged).

- Notes are **data**: persisted in a new **`NOTES` section (`0x07`, postcard)** of the
  `.heyl` container, owned by the frontend store and broadcast across a project's windows
  as shared **UI state** (`uiState` keys `notes` + `focusedNoteId`, ADR-11); note edits
  mark the project dirty and are one undo step.
- The **panel is chrome**: a new **fixed region** (a right rail), not a tab, hidden by
  default and toggled from the Toolbar, resizable, and view-persisted (open/closed +
  width) — so the "only tabs are Workbench tabs" rule holds.
- **Surfacing** is by group: every note a **Timeline** anchor; a chart draws its **own**
  notes; exactly one **selected** note draws on **every time-based chart** (the `time` sync
  group), never on the frequency-axis `spectrum`. Selecting a note opens/raises its chart
  but **never moves the analysis window** — that is the row's explicit **Analyze** action
  (ADR-19). The anchors live in a thin **strip along the bottom** of the Timeline and of
  each time chart, clear of the window move handle and of a chart's drag/zoom area; a
  **range** is a selection there, with a handle on each edge. With the rail closed the
  focus is dropped and the anchors are drawn **dull** (a note is only "focused" while you
  are working with the panel).
- The body is **markdown**, stored raw and rendered **sanitized**, with an editor that
  commits **explicitly** (Done / ⌘↵; Escape discards) rather than on blur.
- A note can be **popped out into its own window** — a real Tauri window aliased to the
  parent project, exactly like an analyzer tab's *Pop out to window* (ADR-11), raised
  rather than duplicated.
- Reachable headless as **read-only** over a saved project (CLI `notes <file.heyl>`); the
  MCP `*_note` tools are **app-only** (a note lives in a project).

**Consequence:** the project gains a commentary layer that is portable, self-describing
(a frozen snapshot, not a dangling number), and visible wherever the annotated moment is
drawn — while staying out of the analyzer/tab model. Costs: a new container section, a
markdown renderer dependency, and the window plumbing for a note's own window. The frozen
snapshot can drift from the live analysis, so a row shows the **current** readout with the
frozen one struck through beneath when they differ (rather than a silent live value, or a
stale hint). To keep the units honest, every analyzer chart draws **source seconds**
(results are re-based by the engine, see
[`analysis-tools.md`](analysis-tools.md) → Chart rendering), so a note never needs a
per-chart conversion. See [`notes.md`](notes.md).

**Status: delivered (M14), revised after review** (bottom strip, draggable range edges,
explicit-save editor, source-second axes, note window, and the count chip replacing the
badge), then again for the interaction model — see **ADR-19**.

## ADR-19 — A note is selected, not focused: the window moves only on Analyze

**Context:** ADR-18 gave notes "focus follows the click": clicking a note highlighted it,
opened its chart **and** moved the analysis window onto its time. In use that was wrong.
A note is a remark *about* a moment the user has already chosen; clicking it — or, worse,
grabbing its handle by a pixel — yanked the analysis away from what they were looking at,
and creating a (point) note felt like it reframed the window. The two intents ("show me
this note" vs. "analyse this span") were fused into one gesture.

**Decision:** split them.

- **Select** (`selectNote`) — highlight the note and open (or raise) the chart it belongs
to. This is what the row heading, the row's chart action and the lane are wired to. It
  **never** touches the analysis window, so selecting or creating a note can never reframe
  the analysis.
- **Analyze** (`analyzeNote`) — the row's explicit **Analyze** action, and the *only*
  thing that moves the window onto a note: a range becomes the window exactly, a point
  gets a window of the current width (or a tenth of the source) starting at its time.
  Offered on **both** kinds of note (a point has a moment worth analysing too).
- The **focused** note is a **panel** concept: closing the rail drops the focus, which
  also clears the charts' full-height overlay and the Timeline's stem. The lane anchors
  stay as an index of where the notes are, drawn dull.

**Consequence:** browsing the rail (or the lane) is now a read-only act, and reframing is
always one deliberate click. Costs: one more icon in the row, and "where is this note?"
is answered by Analyze rather than by the click itself. See [`notes.md`](notes.md).

**Status: delivered (M14 follow-up).**
