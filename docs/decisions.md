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

## ADR-3 — One window = one project

**Decision:** each Tauri window hosts one independent project; no shared state.

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
not used:** the only tabs in the app are the analyzer tabs inside the Workbench,
owned by `dockview` (ADR-1), so a Kobalte `Tabs` region would violate that rule.
The vendor libraries push the bundle past Vite's 500 kB warning, so
`vite.config.ts` splits them into their own chunks (`dockview`, `kobalte`) with
`build.rolldownOptions.output.codeSplitting`; the app chunk itself stays small.

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
