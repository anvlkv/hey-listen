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
> `postcard` cannot encode internally-tagged enums. `RESULTS` was written empty when
> M6 shipped; it now carries one entry per cached analyzer result — see the format
> doc's Cached results.

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

**Status: delivered (M10); superseded for the batch CLI by ADR-29 (M33.B).** The batch
subcommands left the app binary for the `hey-listen-cli` console binary, and
`plugins.cli` now declares only `--mcp` / `--headless` (plus the `.heyl` open path).
Everything above still describes the *engine* contract ADR-29 preserves: the one shared
headless session, the JSONL envelope, the `-p` / `-o` vocabulary and the `0`/`1`/`2`
exit codes. See [`cli.md`](cli.md); the batch logic stays in
`src-tauri/cli/src/batch/`.

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
batch CLI, with one serialisation rule instead of three. The CSV renderer is **Rust-only**
(the UI asks the core to render, then writes the returned text), so the app, MCP, and CLI
cannot drift; very wide matrices (high FFT / bin counts) are the format's nature, not a
quirk. See [`exports.md`](exports.md).

**Status: implemented (M12).**

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

## ADR-18 — Annotations are project content: a time + chart anchor with a frozen values snapshot

**Context:** the app can analyse audio from many angles but has no place to record an
*observation* — "the third harmonic spikes here", "this is a room reflection". Such a
remark is meaningful only next to the audio moment and the chart it was read off, and it
must survive the window / params moving on. It is neither an analyzer (it produces no
`AnalysisResult`) nor a Workbench tab (those are content, and the fixed-region rule keeps
non-tab chrome out of `dockview`).

**Decision:** add a **annotation** — a small serde payload anchored to an audio **time** (a
point, optionally a `range`) and to an optional **analyzer tool id** (absent = a
Timeline annotation), carrying a **markdown** body and a **frozen** `values` snapshot (the
chart's readout at that time, with its `window` / `params` / `options` provenance,
refreshed whenever the annotation is edited or dragged).

- Annotations are **data**: persisted in a new **`ANNOTATIONS` section (`0x07`, postcard)** of the
  `.heyl` container, owned by the frontend store and broadcast across a project's windows
  as shared **UI state** (`uiState` keys `annotations` + `selectedAnnotationId`, ADR-11; the MCP wire
  key stays `selectedAnnotationId`); annotation edits mark the project dirty and are one undo step.
- The **panel is chrome**: a new **fixed region** (a right rail), not a tab, hidden by
  default and toggled from the Toolbar, resizable, and view-persisted (open/closed +
  width) — so the "only tabs are Workbench tabs" rule holds.
- **Surfacing** is by group: every annotation a **Timeline** anchor; a chart draws its **own**
  annotations; exactly one **selected** annotation draws on **every time-based chart** (the `time` sync
  group), never on the frequency-axis `spectrum`. Selecting an annotation opens/raises its chart
  but **never moves the analysis window** — that is the row's explicit **Analyze** action
  (ADR-19). The anchors live in a thin **strip along the bottom** of the Timeline and of
  each time chart, clear of the window move handle and of a chart's drag/zoom area; a
  **range** is a selection there, with a handle on each edge. With the rail closed the
  focus is dropped and the anchors are drawn **dull** (an annotation is only "focused" while you
  are working with the panel).
- The body is **markdown**, stored raw and rendered **sanitized**, with an editor that
  commits **explicitly** (Done / ⌘↵; Escape discards) rather than on blur.
- An annotation can be **popped out into its own window** — a real Tauri window aliased to the
  parent project, exactly like an analyzer tab's *Pop out to window* (ADR-11), raised
  rather than duplicated.
- Reachable headless over a saved project (CLI `annotations <file.heyl>`: list / get since
  M14; add / update / delete since M25.D); the MCP `*_annotation` tools are **app-only** (a
  annotation lives in a project).

**Consequence:** the project gains a commentary layer that is portable, self-describing
(a frozen snapshot, not a dangling number), and visible wherever the annotated moment is
drawn — while staying out of the analyzer/tab model. Costs: a new container section, a
markdown renderer dependency, and the window plumbing for an annotation's own window. The frozen
snapshot can drift from the live analysis, so a row shows the **current** readout with the
frozen one struck through beneath when they differ (rather than a silent live value, or a
stale hint). To keep the units honest, every analyzer chart draws **source seconds**
(results are re-based by the engine, see
[`analysis-tools.md`](analysis-tools.md) → Chart rendering), so an annotation never needs a
per-chart conversion. See [`annotations.md`](annotations.md).

**Status: delivered (M14), revised after review** (bottom strip, draggable range edges,
explicit-save editor, source-second axes, annotation window, and the count chip replacing the
badge), then again for the interaction model — see **ADR-19**.

## ADR-19 — An annotation is selected, not refocused: the window moves only on Analyze

**Context:** ADR-18 gave annotations "focus follows the click": clicking an annotation highlighted it,
opened its chart **and** moved the analysis window onto its time. In use that was wrong.
An annotation is a remark *about* a moment the user has already chosen; clicking it — or, worse,
grabbing its handle by a pixel — yanked the analysis away from what they were looking at,
and creating a (point) annotation felt like it reframed the window. The two intents ("show me
this annotation" vs. "analyse this span") were fused into one gesture.

**Decision:** split them.

- **Select** (`selectAnnotation`) — highlight the annotation and open (or raise) the chart it belongs
  to. This is what the row heading, the row's chart action and the lane are wired to. It
  **never** touches the analysis window, so selecting or creating an annotation can never reframe
  the analysis. The persisted state is `selectedAnnotationId`, and the MCP wire names are the same
  (`set_selected_annotation`, `get_state.selectedAnnotationId`).
- **Analyze** (`analyzeAnnotation`) — the row's explicit **Analyze** action, and the *only*
  thing that moves the window onto an annotation: a range becomes the window exactly, a point
  gets a window of the current width (or a tenth of the source) starting at its time.
  Offered on **both** kinds of annotation (a point has a moment worth analysing too).
- The **selected** annotation is a **panel** concept: closing the rail clears the selection,
  which also clears the charts' full-height overlay and the Timeline's stem. The lane
  anchors stay as an index of where the annotations are, drawn dull.

**Consequence:** browsing the rail (or the lane) is now a read-only act, and reframing is
always one deliberate click. Costs: one more icon in the row, and "where is this annotation?"
is answered by Analyze rather than by the click itself. See [`annotations.md`](annotations.md).

**Status: delivered (M14 follow-up).**

## ADR-20 — Annotations and detected notes are distinct terms

**Context:** M14 introduced user-authored **annotations** (markdown anchored to a time and a
chart). M18 adds **note segmentation**, whose result is a list of detected audio notes.
Calling both "annotations" makes the UI rail and the analyzer table ambiguous, and the M14
docs already used "annotation" as a synonym for the commentary payload.

**Decision:** reserve the terms by origin:

- **Annotation** — what the user writes (M14). The UI labels the right rail
  **Annotations**, the add action **Add annotation here**, and the row/window copy says
  annotation.
- **Note / note segment** — what the engine detects (M18, `noteMetrics`). The analyzer is
  titled **Note segments** and its table is *detected notes*.

**One vocabulary:** the `Annotation` type, the frontend `annotations` store, the project
file's `ANNOTATIONS` section and the MCP/CLI `*_annotation` / `annotations` names all use
the same word; the only thing still called a **note** is the musical segment the
`noteMetrics` analyzer detects.

**Consequence:** every user-facing surface can say the precise thing without a schema,
file-format, or MCP-tool alias. There is no compatibility name: a project annotation is
only ever an **annotation**, and a detected segment is only ever a **note**.

**Status: delivered (M18).**

## ADR-21 — Live synth: audition is a core loop; edits rewrite the source in place

**Context:** the synth graph is only heard after **Render**, which renders the whole
graph, streams it to the frontend and **replaces the source** (resetting the timeline and
its analysis window). Building a graph means render → confirm → lose the window → repeat.
The want is to hear the graph while editing it and to let the analysis follow the edits.

**Decision:** split the two jobs.

- **Audition** (`preview_synth`) renders a short loop in the core and plays it through the
  window's existing `Playback`. It never touches the source, so it is safe while any file
  is open, and it is fast enough to re-render on a trailing debounce.
- **Live source** (`update_synth_source` / `live_synth`) renders the requested length and
  overwrites the **synth source in place**: the window, view, annotations and analyzer tabs
  stay put, and the analysis re-runs against the new PCM. The first write to a non-synth
  source confirms the replacement (the one-source rule still holds); later writes do not.
- Both facets render once per settle when they are used together. **Render once** remains
  the long-form/one-shot path and is what headless MCP and the CLI use.

**Consequence:** the timeline/analysis is live while composing, at the cost of a render per
settled edit (capped at 10 s for Live; longer graphs use Render once). Undo/redo still works
through the graph snapshots and re-renders as a consequence; the source PCM is not itself a
history entry. A truly phase-continuous rebuild and a persistent net are deferred. See
[`graph-editor.md`](graph-editor.md) and [`source-model.md`](source-model.md).

**Status: proposed (M22).**

## ADR-22 — The playhead is transport state, not a preview side effect

**Context:** the playhead is computed from the last preview start and cleared on stop, so
pausing is really stopping, the line vanishes, and every resume restarts at the region
start. There is no pause or seek, and the core reports no position once it stops.

**Decision:** make the transport explicit.

- `Playback` owns the position and keeps it across pause and stop; `seek` moves it, and a
  region reload can resume at an offset.
- The frontend `transport` state owns `status`, `position`, `region`, `loop`, `speed` and
  `owner`. **Play/Pause** is primary; **Stop** silences but leaves the line where it is;
  **Return to start** is a separate action. The playhead is drawn whenever a position
  exists (dimmed when paused) and is shared on the chart bus as `{ secs, playing }`.
- The playhead and the analysis window are independent. A **reframe** frames the view and
  may focus the Timeline, but it does not redefine the playhead; a window change clamps an
  idle playhead into the new window rather than moving the window.

**Consequence:** charts and the Timeline agree on what is being auditioned, pause/resume
is meaningful, and a paused project still shows where it stopped. Source changes remain the
only implicit reset. See [`annotations.md`](annotations.md) → Preview playback.

**Status: proposed (M23).**

## ADR-23 — One command registry drives keyboard, palette, and shortcut UI

**Context:** keyboard behaviour is split between native menu accelerators, component-local
handlers (annotation editor, scrollbar, context menus) and browser defaults. There is no
inventory, no discoverability, and no way to rebind anything.

**Decision:** a single **command registry** is the source of truth: each command declares
an id, title, category, default binding, scope/`when`, handler, and whether it may run in a
text field or repeat. The dispatcher, **command palette**, **Keyboard Shortcuts dialog**,
tooltips and `aria-keyshortcuts` all read that registry. Bindings are app-level,
versioned, persisted in `localStorage`, and rebindable with conflict detection.

**Consequence:** new actions must register rather than attach an ad-hoc listener, which is
the point. Native menu accelerators stay read-only for this milestone because Tauri would
need the menu rebuilt on every binding change; making the menu itself data-driven is a
follow-up. See [`hotkeys.md`](hotkeys.md).

**Status: proposed (M24).**

## ADR-24 — Comparison is a transient, read-only view over two projects

**Context:** diffing two audio sources needs two independent analysis setups (source,
filter, synth, window, params). Adding a second *track* to a project would duplicate the
source/filter/window model inside `AudioState` and contradict ADR-3 and ADR-9, and would
make every store, the project file and the Workbench track-aware. The app already runs
independent project windows, so the second analysis setup exists — what is missing is a
view that spans two of them.

**Decision:**

- A comparison binds **(owner project A, reference project B, one `AnalyzerId`)**. Both
  are ordinary project windows; no popout and no second source is involved.
- The **core** computes both sides through the existing `analysis::run_window`, each from
  its own `WindowState` (own PCM and own filter). A's setup is sent by its frontend; B's
  is read from B's shared UI state. B is **read-only** — the comparison never mutates it.
- The compare view is a **transient Workbench tab** in A that **pops out like any tab**.
  It is **not project content**: excluded from `LAYOUT` (sanitised), `SETUP.openTools`,
  `RESULTS`, undo history, the dirty signature and Recent; a compare popout is registered
  with its `(AnalyzerId, reference)` but never returned by `popout_tools_of` and never
  restored on load (ADR-28: those ids stay typed). Saving while it is open writes the
  project as if it were closed.
- Comparability is **explicit**: a grid signature gates the numeric delta, differing
  windows diff over their absolute-time overlap, and every differing setting is reported.
  There is no silent normalisation.
- The same operation is exposed by the native **Analysis** menu and a tab context menu,
  by MCP `compare_analysis` (app-only), and by the CLI `compare` subcommand (two project
  files, each with its saved setup). *M25.D:* a headless session compares against a
  project file, so the same operation works without two windows.

**Consequence:** the diff is available without changing ADR-3, the source model, or the
project file's audio layout. The cost is a second set of peer-read commands, a revision
counter, a compare-view chart layer, and a **third popout kind** (a compare window is
still a view of A, registered with its `AnalyzerId` + reference, but never saved).
Because each side keeps its own settings, a diff is only numerically meaningful when the
grids match; the badge and mismatch list are part of the contract, not a nicety. Peer
cursors/playheads are polled read-only, so the compare view never drives B's transport.
The CLI needs the compiled filter spec in `LAYOUT` to reproduce the app's conditioning.
See [`comparison.md`](comparison.md).

**Status: implemented (M25, views completed in M25.A); partially superseded.**
`audio/analysis/compare/` computes the diff for every family; `commands/compare/` owns
the IPC/lifecycle surface; the frontend's `state/compare/` + `components/compare/` chart
every family (series, spectrum, readouts, matrix/spectrogram, rhythm/events,
`noteMetrics`, modulation, waveform); the CLI's `compare` reads `LAYOUT.filterSpec`.
**ADR-26** (M25.B) replaced the absolute-overlap rule with relative alignment and a
manual offset; **ADR-27** (M25.C) made the comparison's reference side a saved project
snapshot. The compare *panel* still never enters `LAYOUT`.

## ADR-25 — Psychoacoustic analyzers are a calibrated, standards-honest layer over dBFS

**Context:** perceptual descriptors (loudness, sharpness, roughness, fluctuation
strength, masking) are defined over an **absolute sound-pressure axis (dB SPL)**, while
the analysis engine conditions and reports every window in **dBFS**. The existing EBU
R128 tools measure programme **level** in LUFS, not perceived loudness. Adding a
perceptual layer therefore needs (a) an explicit dBFS → dB SPL mapping, (b) a choice of
model per descriptor, and (c) an honest line between a standardized model, a published
approximation of one, and a physical proxy.

**Decision:**

- Psychoacoustics is a **new layer** (`audio/analysis/psychoacoustics/`) that consumes
the existing STFT / frame-RMS output. No fork of `oxiaudio` and no machine-learning
models.
- **Calibration is a per-tool option** `calibrationDbSpl` (the dB SPL of a full-scale
sine). `0` means **uncalibrated**: the engine still runs the model, but the summary and
readouts label the result relative, so a sone value is never presented as absolute
without a reference. Nothing is added to `SharedParams` (postcard compatibility, ADR-6).
- **One committed model per descriptor, named in the UI and docs:** ISO 532-2
(Moore–Glasberg, stationary) for loudness, DIN 45692 for sharpness, a Daniel–Weber-style
model for roughness, the Osses–García–Kohlrausch family for fluctuation strength, an
MPEG-style tonal/non-tonal spread for masking, and ISO 226 tabulated contours for the
equal-loudness overlay. Bark and ERB scales are both supported and are never treated as
interchangeable.
- **No conformance claims.** The published approximations implement the model families;
the normative coefficients and conformance procedures may require purchase, so the copy
says “model” / “proxy”, never “ISO-compliant”. The tonality ratio and the stereo cues are
labelled **physical proxies**, not perceptual metrics, and no single “perceptual score”
is assembled from these tools.
- **Stereo is the one exception to channel selection.** `spatial` reads `Left`/`Right`
before the shared channel param is applied (every other tool conditions to mono first),
and returns no result for a mono source.
- **Result families reuse the existing shapers:** `criticalBands` / `specificLoudness`
are matrices, `masking` is a spectrum overlay, the rest are series. MCP/CLI catalog,
option metadata, compaction, and CLI `-o` follow the M21 contract unchanged.

**Consequence:** the perceptual tools are honest about their assumptions (calibration
and model choice are explicit), land without a project-file schema bump, and reuse the
chart and MCP/CLI plumbing. The cost is a per-tool calibration knob duplicated across
the loudness family (like the per-tool f0 range in M16), a documented stereo bypass, and
a heavier `roughness`/`fluctuationStrength` pipeline. A shared app-level calibration
control can fan out to the per-tool options later without a schema change. See
[`analysis-psychoacoustics.md`](analysis-psychoacoustics.md).

**Status: proposed (M26–M31).**

## ADR-26 — Compare alignment is relative, with a manual fine-tune offset

**Context:** ADR-24 compares the two windows over their **absolute-time intersection**.
That is the right rule for "the same moment of the same recording", but it makes two
normal cases uncomparable: windows that start at different points, and windows of
different lengths (the intersection may be empty, or much shorter than either result).
The useful question is usually "how does the first/second of B differ from the
first/second of A", with the user able to nudge B by a few milliseconds.

**Decision:**

- Each side is placed on a **relative** axis `x = t − result.windowStart`. Absolute
  overlap no longer gates `aligned`; the relative axis always exists.
- The chart extent is the **displayed A** side's window duration; `Swap A/B` swaps the
  extent, the clipping and the offset's sign with the sides. Displayed B is clipped where
  its data ends, and never stretched.
- The delta, matched pairs and matrix columns cover the **common span**
  `[max(0, δ), min(durA, δ + durB)]` — the longer side is clipped to the shorter.
- A **fine-tune slider δ** (±1 s, 1 ms steps, 0 default, positive = B later) moves B on
  the axis. It changes **alignment only**: neither side is re-analyzed. `run_comparison`
  takes `bOffset`, so the delta/stats/pairings and the chart always agree; MCP and the CLI
  expose the same field.
- Matching stays **nearest-time within a tolerance** and is done on the relative axis
  (`0.6 × hop` for frames; `max(20 ms, 2 hops)` for events). A matrix frame with no
  counterpart is a **null** column, not a dropped one. Waveform envelopes have a
  length-dependent bucket step, so the delta samples the neighbour envelope at the
  displayed A's bucket times (nearest within one bucket).
- Live markers are remapped to the relative axis; the compare chart keeps A's sync group
  by converting absolute ↔ relative at the plugin boundary.

**Consequence:** windows with different starts and lengths are comparable without
re-slicing or stretching audio, and the user can compensate for a small offset. The cost
is a second concept in the contract (`alignment` beside the informational `overlap`), a
re-run on every settled slider move (A and B are re-run; results are unchanged, only the
matching), and a waveform delta that is exact only when the durations match. Automatic
alignment (cross-correlation / DTW) remains out of scope. See
[`comparison.md`](comparison.md).

**Status: implemented (M25.B).** The core matches on a relative axis (`Alignment` with
`aDuration` / `bDuration` / `bOffset` / `common`); `run_comparison`, MCP `bOffset` and
CLI `--b-offset` expose the offset, and the frontend's `components/compare/time.ts`
holds the display transform (including the swap).

## ADR-27 — The last comparison is saved as a reference snapshot

**Context:** ADR-24 made comparisons transient: the reference picker forgot its choice
and reopening one project lost the comparison. In practice a comparison is often part of
the project's state ("this call vs that call"), and the second project's source may not be
available later. Keeping the reference project open just to see the diff is fragile.

**Decision:**

- The project file gains a `COMPARE` section (id `0x08`): one **snapshot per comparison
  open at save time** (tab or popout), not a link to another project. It stores the
  `AnalyzerId`, the reference's **display name** (window labels are session-scoped),
  source shape, window, shared params, effective options, filter fingerprint, the
  fine-tune offset, and the reference's **full last `AnalysisResult`**. No reference
  audio is embedded.
- The snapshot is `postcard`-encoded through a small externally tagged wrapper (the IPC
  `AnalysisResult` is internally tagged, which `postcard` cannot encode). The result
  structs gain `Deserialize`; the section is additive and forward-compatible.

> **Amended (bug fix):** `postcard` cannot read a field that the writer skipped. A result
> payload that omits an absent optional key on the JSON wire (`SeriesResult`'s
> `frameSize` / `gate`, `NoteMetricsResult`'s `syllables`) is therefore stored through a
> positional wrapper that writes every field (`StoredSeries`, `StoredNoteMetrics`);
> without it a saved series / grouped-annotations comparison was unreadable. The JSON wire is
> unchanged.
>
> **Amended (M25.C follow-up):** a snapshot also records the reference project's
> **file path** (`referencePath`, appended last), and the compare view's **Open
> reference** opens exactly that file. Resolving the other project by display name was
> wrong: two projects can share one, and an origin project's title can share a prefix
> with the owner's file — the button opened the owner instead of the reference. A
> snapshot without a path (a comparison against an unsaved project) and a deleted
> reference file both report a notice. The field landed inside container version 1, so
> version 1 shipped two payload layouts; M37 bumped `VERSION` to 2 and the `v1 → v2` step
> reads the older layout and stores no path, instead of the reader retrying at every load.
> See [`project-file-format.md`](project-file-format.md) → Migrations.
- A comparison may bind to a **live** project or to its **saved snapshot**. Live wins; a
  saved binding shows the stored B band, hides B's live markers, marks the badge **saved
  reference**, and runs only A when the view re-computes.
- Saved comparisons **restore as Workbench tabs** after load (never as popout windows);
  the compare panel stays out of `LAYOUT`.
- Reconnect is **explicit**: the picker hints when an open project's name matches but
  never rebinds automatically. Retargeting to a live project resets the offset.
- While a compare view is open, a **settled** change in the live reference is part of the
  owner's dirty signature (the snapshot would change). Snapshots stay out of undo/redo;
  closing the compare tab and saving drops the snapshot (one per tool).
- MCP `compare_analysis` can use the saved side (`saved: true`, `with` omitted);
  `get_state` / `list_projects` report the saved comparison and its offset.

**Consequence:** a project is self-contained for its last comparison and survives a
missing reference project. The cost is a per-tool result in the file (≈0.5 MB worst case
for a spectrogram), `Deserialize` on every result struct, a saved/live lifecycle in the
view, and a dirty state that now includes a settled peer change. A snapshot is **frozen**:
editing the reference project afterwards does not update it until the comparison is made
and saved again. See [`comparison.md`](comparison.md) and
[`project-file-format.md`](project-file-format.md).

**Status: implemented (M25.C).** The `COMPARE` section is written by
`save_project` and read by `load_project`; the core keeps the last successful reference
side per tool, saved comparisons restore as tabs bound to the snapshot, and
`compare_analysis { saved: true }` / `get_state.compare` / `list_projects` expose it.
See [`comparison.md`](comparison.md) for the delivered contract and its one recorded
deviation (a compare popout's live change is not in the owner window's dirty flag).

## ADR-28 — String identifiers become strum enums

**Context:** the Rust core carried a lot of enumerable state as bare strings and
compared it with hand-written `match` arms and `&'static str` tables in several places:
the analyzer ids (`AnalysisResult::tool_id`, `family_of`, `about`, the catalog),
the result `Family`, the catalog `Section`, the project `SourceDescriptor.kind`
(`file`/`mic`/…), the live `CaptureKind`, capture event kinds, the window function
(already a `WindowKind` enum, but matched by hand), the menu/theme/CLI action ids, and
transient view ids (a compare view's tool, a tool popout's tool). A typo was a runtime
`UnknownTool` error or a silent `_ => Family::Series` fallback, and the same id string
was repeated across the engine, the catalog, the persistence sections, the window
registry and the MCP/CLI surfaces — kept in step only by tests and discipline.

**Decision:**

- One `strum` enum per domain — `AnalyzerId` + `ToolId`, `Family`, `Section`,
  `SourceKind` + `CaptureKind` + `CaptureEventKind`, `WindowKind`, and `MenuAction` /
  `ThemeBase` / `ThemeMode` / `BatchCommand` — each derived with
  `strum::{EnumString, Display, AsRefStr, IntoStaticStr, EnumIter, VariantNames}` +
  `serde::{Serialize, Deserialize}` + `ts_rs::TS`. This covers **transient/UI state**
  as well as project data: a compare view's `tool`, a tool popout's id and a capture
  event's kind are ids, so they stay typed.
- `#[serde(rename_all = …)]` and `#[strum(serialize_all = …)]` use the same spelling
(camelCase for the analyzer/menu ids, lowercase for the single-word source/window/theme/
CLI ids, kebab-case for capture event kinds), so the string is identical on the wire and
in code: the IPC JSON, the `postcard` project file and the regenerated `src/bindings/`
stay **byte-for-byte unchanged** — this is type safety, not a format bump.
- `AnalyzerId` is the single source of truth for every tool id. `AnalysisResult` stays a
typed union (its variants map 1:1 to `AnalyzerId`), and `tool_id()` returns `AnalyzerId`.
`ToolId` is generated from the same variant list (plus `filter` / `synth`), so the
analyzer subset and the Workbench tab ids cannot drift. An `EnumIter`-driven test runs
every `AnalyzerId`, asserts the result's `tool_id()` and its serialized `tool` tag
match, and checks the catalog covers every variant; a second test pins the postcard
encoding to the original strings.
- A string is parsed **once at the boundary** (`FromStr` / serde on the command, CLI or
MCP argument, or a project-file load) and dropped; every internal signature takes the
enum.
- **No new `String` / `&str` for an id.** Do not add an id-shaped field, parameter, map
  key or return value as a string when an enum exists (or should exist), and do not
  compare ids to string literals in Rust outside wire-format tests. Legitimate remaining
  strings are genuine boundaries: paths, display/window labels, option and summary keys,
  MCP tool names/schema keys, theme ids, and the open-ended `GraphNode.kind`. This is a
  **standing rule** for new work, not a one-off migration; the checklist lives in
  `AGENTS.md` → "Typed identifiers — no string ids".
- `SourceDescriptor.kind` became a `SourceKind` enum **field** (a C-like enum serialized
as a string), not an internally-tagged enum — `postcard` still cannot encode
internally-tagged enums (ADR-2), so the struct stays the top-level shape.

**Consequence:** typos and id drift become compile errors, and `EnumIter`/`VariantNames`
let the catalog and engine dispatch stay in lockstep structurally instead of by a string
list. The same enums flow through transient state (compare views, popouts, capture
events) and the frontend imports the generated unions instead of redeclaring them. The
cost is one new dependency (`strum`, MIT), a `src/bindings/` regeneration with the
matching frontend imports after each phase, and care that `serde` and `strum` agree on
the wire spelling. See ADR-2 and [`code-hygiene.md`](code-hygiene.md).

**Status: accepted (M15.B, delivered with `strum` 0.28).**

## ADR-29 — The batch CLI is a console binary, not a subcommand of the app

**Context:** ADR-14 made the batch CLI a subcommand of the app binary because the
interface is declared with `tauri-plugin-cli`, and `Cli` cannot be constructed outside a
Tauri app. The field report
([`hey-listen-report.md`](hey-listen-report.md) §3.2, §6.1) measured the cost: every batch
command boots the Tauri app, so scripts pay full app setup per command, inherit the log
plugin's sandbox abort and log-file race, and cannot run on a bare GUI-less host; on
Windows the app binary has no console, so stdout is lost. Those are lifecycle failures,
not engine gaps.

**Decision:** the batch subcommands move to a **plain console binary, `hey-listen-cli`**,
built next to the app like `heylisten-mcp`. It runs `analyzers` / `analyze` / `compare` /
`project` / `annotations` / `synth` over the same `batch::run` and the shared headless
session, with no Tauri app, no window, and no log plugin — so it boots a bare host, never
aborts over a log path, and writes stdout on Windows. The app binary keeps `--mcp` /
`--headless` (and the `.heyl` open path) via `tauri-plugin-cli`; its batch subcommands are
retired.

- **One implementation, one vocabulary.** The command logic moves out of the app lib into
  the crate (`src-tauri/cli/src/batch/`), so the app binary does not compile code only the
  console binary uses. The application crate still owns what both need at the boundary:
  the engine modules (`audio`, `export`, `mcp`, `project`, `recent`, `state`) are public as
  the console crates' link surface. Every batch-owned type — `BatchCommand` included —
  lives in the console crate; the app keeps no copy and no migration fallback.
  The moved tests use the app's `test_support::FailingWriter` through a `test-support`
  feature rather than a second fixture.
- **One interface, no hand-rolled drift.** The console binary parses with `clap` derive.
  The interface is specified once in that definition; the JSONL **envelope** is the pinned
  contract (a test asserts the two entry points produce the same shapes), rather than a
  second JSON schema that can silently disagree. ADR-14's "no hand-rolled parser" is
  superseded for the batch CLI specifically; `tauri-plugin-cli` remains for the app
  binary's two flags.
- **Discovery.** `hey-listen-cli` is the documented binary; the
  `HEY_LISTEN_CLI`/`HEY_LISTEN_BIN` → `PATH` → app-bundle resolution order in the consumer
  scripts prefers it. The app binary no longer accepts the batch subcommands at all.
- **Bundling.** The console binary ships beside the app (`externalBin` sidecar — correct
  now, because the menu in ADR-31 *spawns* it to install it). It lives in its own crate
  (`src-tauri/cli/`), so the app package has no `hey-listen-cli` bin target for the
  bundler to install a second time. `heylisten-mcp` stays a separate, unbundled MCP client
  binary.

**Consequence:** scripts stop paying app-boot per command; the batch CLI gains a Windows
stdout and a headless host. The cost is a second argument parser to keep in step with the
engine — mitigated by sharing `batch::run` + the headless session and by the
envelope-consistency test — and a one-time consumer migration off the app-binary spelling.
See [`cli.md`](cli.md) and ADR-14 (revised).

**Status: delivered (M33.B).** The console binary is its own crate — `src-tauri/cli/`
(package `hey-listen-cli`, entry `src/main.rs`), which links the app lib — so the app
package has no `hey-listen-cli` bin target; that is what lets it ship purely as the
`bundle.externalBin` sidecar staged by `scripts/prepareSidecar.mjs`, instead of being
bundled twice ([`packaging.md`](packaging.md)). The crate owns the implementation
(`src/batch/`, moved out of the app lib) and its tests; its interface is
`src/batch/clap_args.rs`; the app binary keeps only `--mcp` / `--headless` and the `.heyl`
open path. `src/batch/tests/console.rs`
pins the mapping against the retired `plugins.cli` one. See [`cli.md`](cli.md).

## ADR-30 — Self-update via the Tauri updater over a GitHub Releases static feed

**Context:** releases are built by GitHub Actions and published as GitHub Releases
([`packaging.md`](packaging.md)), but the app never checks for a newer build and the
bundles are unsigned. A user must re-download manually. The updater plugin requires a
signature (which cannot be disabled) and a feed of signed artifacts per platform.

**Decision:** use `tauri-plugin-updater` with a **static JSON** feed published to GitHub
Releases, and sign with a Tauri key pair.

- **Plugin.** `tauri-plugin-updater` (Rust) + `@tauri-apps/plugin-updater` (JS),
  initialized desktop-only; `bundle.createUpdaterArtifacts: true`; the **public** key in
  `plugins.updater.pubkey`; `endpoints` point at the static feed
  (`…/releases/latest/download/latest.json`); `updater:default` in capabilities; a
  `@tauri-apps/plugin-process` relaunch after install.
- **Keys.** `tauri signer generate` produces a key pair. The **private** key is a repo
  secret (`TAURI_SIGNING_PRIVATE_KEY`, with an optional password secret); the public key
  is committed in `tauri.conf.json`. Losing the private key strands already-installed
  users — it is stored like any signing secret, never in the repo or a `.env` file.
- **Delivery.** The release workflow sets `createUpdaterArtifacts` so each platform emits
  its updater bundle + `.sig`, uploads them, and publishes a `latest.json` per
  `OS-ARCH` via tauri-action, so `check()` validates the whole feed before comparing
  versions. Version bumps stay in the three pinned places (`tauri.conf.json`, `Cargo.toml`,
  `package.json`).
- **CLI follows the app.** The installed `hey-listen-cli` records the app version it was
  installed from; the updater (or app launch) refreshes an out-of-date installed CLI from
  the updated bundle. The app version is the single source of truth for what the CLI
  should be — there is no independent CLI release channel.

**Consequence:** users get a signed, in-app update path with no separate server (GitHub
Releases is the CDN), and the installed CLI stays in lockstep with the app. Costs: a new
plugin + JS binding, signing-key discipline in CI, and updater-artifact size in each
release. See [`updater.md`](updater.md).

**Status: accepted, delivered (M33.C).** The commands are `check_update` /
`install_update` in `src-tauri/src/commands/update.rs`; the surface is the About dialog's
Updates section (`src/components/AboutUpdates.tsx`), reached from *Help → Check for
Updates…*. The installed CLI is refreshed on launch by
`src-tauri/src/commands/cli_install.rs`. See [`updater.md`](updater.md).

## ADR-31 — The app installs its own console CLI from a menu

**Context:** M33's original ask — install the batch CLI without hunting for the bundled
binary — becomes concrete once ADR-29 ships `hey-listen-cli` as a bundled artifact. The
question is the mechanism: a menu action that copies a real binary to a PATH location,
tracked so it can update (ADR-30) and be repaired/uninstalled.

**Decision:** a native menu entry ("Install Command Line Tool…") installs
`hey-listen-cli` to a per-platform location and records the version it wrote.

- **Install.** The app resolves a writable, per-user location on `PATH` (a `~/.local/bin` /
  `~/bin` shim or symlink on macOS/Linux; a `%LOCALAPPDATA%`-based shim on Windows), copies
  or links the bundled console binary there, and reports the exact path. The action is
  user-initiated and consent is the click itself; no elevation is requested (the target is
  user-writable).
- **Version & lifecycle.** The install records the app version it came from; the menu
  becomes **Update / Repair / Uninstall** when a CLI already exists, comparing the recorded
  version to the app. ADR-30 is the only update path — the menu never installs a version
  the app itself is not running.
- **Reporting.** Success/failure and the written path surface in the menu or an app dialog;
  a failure leaves any existing install untouched (copy-then-swap).

**Consequence:** a user can make `hey-listen-cli` available on `PATH` in one action, and
its lifecycle (update/repair/uninstall) is owned by the app, in step with the updater.
Cost: a small install/version-tracking surface and a menu item. See
[`updater.md`](updater.md) and [`packaging.md`](packaging.md).

**Status: accepted, delivered (M33.D).** The menu item and its dialog are
`MenuAction::InstallCliTool` (`src-tauri/src/menu.rs` → *Help → Install Command Line
Tool…*) and `src/components/CliToolDialog.tsx`; they read and drive the M33.C commands in
`src-tauri/src/commands/cli_install.rs`. See [`updater.md`](updater.md).

## ADR-32 — Project file migrations are explicit, incremental, and scriptable

**Context:** the container's `version` field is currently a single `u32` that the reader
rejects unless it equals `VERSION`; a future incompatible change (a `postcard` payload
shape change, a field's meaning change, a `DATA` sub-layout change) would either strand old
files or require ad-hoc, one-off decode fallbacks like `compare_from_bytes`. `postcard` is
not self-describing — no field names, no skipping — so "old file, new struct" fails to
decode, and "new file, old struct" can silently misread trailing fields. Analysis results
are a recomputable cache, so they need not be migrated.

**Decision:** bump `VERSION` only on an incompatible change, record each bump in a single
history, and migrate **incrementally** with an explicit script — never silently.

- **Version history.** `project-file-format.md` owns the authoritative `Format version
  history` table; the reader's supported range and step table are derived from it. Additive
  sections, `LAYOUT` JSON keys, and `tool_options` map keys never bump.
- **Incremental chain.** `project/migrate/` holds one `from_vN_to_vNp1` per bump, each a
  frozen `vN` snapshot of only the payload types that changed plus a conversion. The reader
  hands the payloads over as raw `postcard` bytes, so a step decodes only what it changes
  and everything else passes through untouched; `postcard` is not self-describing, so this
  is the only way an old payload can be read with today's struct. Steps compose
  version-to-version; a step never rewrites `DATA`. The step table is one constant,
  asserted by a test to cover `MIN_READ_VERSION..VERSION`.
- **Load-time migration.** `read_project` accepts `MIN_READ_VERSION..=VERSION`, migrates in
  memory, and reports the source version (`upgradedFrom`); the app marks the project dirty
  so the next save writes the current version. Newer versions are still refused — never a
  best-effort read.
- **Explicit script.** `hey-listen-cli migrate` runs the same chain and writes atomically
  via `write_project_atomic` (with a `.bak` by default, `--no-backup` to opt out), reusing
  `read_project` so there is one code path. It is the bulk/headless upgrade path.
- **Drop results, keep the work.** `RESULTS` is dropped for pre-`VERSION` files and a
  `COMPARE` section whose snapshots do not decode is dropped with a warning; `SOURCE`,
  `DATA`, `SETUP`, `LAYOUT` (graphs + `filterSpec`), `META`, and `ANNOTATIONS` must
  survive, and a hop that cannot produce one fails the load rather than silently emptying
  it.
- **Reference projects.** The loader reports `embedded` (whether `DATA` was present); the
  save and `migrate` paths preserve `embedSource: false` so a reference project does not
  silently grow into a full copy (`migrate --embed` is the explicit opt-in).

**Status: accepted, delivered (M37).** The chain is `src-tauri/src/project/migrate/`
(`Sections` / `Step` / `STEPS` / `run`), the range check and `MIN_READ_VERSION` live in
`project/mod.rs` + `read.rs`, the script is `cli/src/batch/migrate.rs`, and the app's
reference-aware save + "upgraded from vN" notice are `state/project/{signals,save,load}.ts`
and `components/Toolbar.tsx`. Add the first real step when `VERSION` first bumps.

**Consequence:** old projects open transparently and upgrade on save; batch upgrades are
one command; and a future format change is a small, testable, version-keyed step instead of
an open-ended decode gamble. Costs: a frozen `vN` snapshot module per bump (never edited
after release, and pinned by a fixture test that the old file still loads the same way) and
a second CLI surface (`migrate`) to keep in step with the engine. See
[`project-file-format.md`](project-file-format.md) → Format version history + Migrations,
and M37 in [`roadmap.md`](roadmap.md).
