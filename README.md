# Hey Listen

Audio analysis workbench. Capture, filter, and analyze audio from files, live
inputs (mic / system / per-process / mix), and fundsp synthesis — then save it all
into a single binary project file.

> **AI assistance:** This project was scaffolded and developed with the help of AI
> coding agents. AI-generated code and documentation should be reviewed before
> relying on it.

## For users

<img src="src-tauri/icons/icon.png" alt="Hey Listen app icon" width="160">

Point Hey Listen at a sound and it tells you what's inside it. Open a file, or
grab the mic, the system output, a single app, or a mix of them; the Timeline
draws the waveform, and the Workbench gives you a full analysis bench on top of
it.

**Bring any source.** File decode, live capture (microphone, system loopback,
per-process, or mic+system mix), or synthesized audio from a fundsp net. One
window is one project is one source — swapping the source replaces the whole
timeline.

**Filter before you measure.** Build a filtering graph in the Filter tab and it
runs upstream of playback *and* every analysis tool; a Toolbar toggle bypasses
it when you want to hear the difference. A separate Synth tab renders fundsp
synthesis into the timeline.

**Analyze everything.** Around two dozen tools, all computed off the main thread
so the UI stays live: waveform and level meters; spectrum, spectrogram, mel
spectrogram, MFCC, chromagram, and the spectral descriptors (centroid, flux,
rolloff, flatness, contrast, bandwidth, entropy, crest factor, harmonic ratio,
zero-crossing rate); pitch by pYIN / YIN / autocorrelation; tempo, onsets, and
downbeats; and EBU R128 loudness (integrated / momentary / range).

**Move through it fast.** Open any tool as a Workbench tab, drag it to split or
join groups, or pop an analyzer out into its own window. Shared params (FFT size,
hop/overlap, window function, channel, frequency range) stay synced across every
tool, and zoom and cursor follow you between tabs — and between a project's
windows. Charts zoom on scroll, spectrograms pan by dragging, and numeric fields
drag-to-adjust. It ships with an auto/dark/light theme, a UI zoom, and a native
menu with recent files.

**Save it all.** The raw audio, plus the source, filter/synth graphs, analysis
setup, and layout, go into one binary `.heyl` project file. Open N of them side
by side; each is fully independent. Drop an audio file on the window to start a
project from it, or double-click a `.heyl` to reopen one.

**Drive it from an agent.** A built-in
[Model Context Protocol](https://modelcontextprotocol.io) server lets an AI agent
open sources, run every tool, edit graphs, preview playback, and save/load
projects — on the *running* window, through the same surface the UI uses, so
agent actions show up live. Toggle it from the Toolbar **MCP** popover, or run it
headless via the `heylisten-mcp` bridge.

**Batch it from a shell.** `hey-listen analyze <FILE>…` runs the same engine over
your files with **no window** and prints one JSON object per file/tool, so a script
or CI job can bulk-analyze and pipe straight to `jq`. Shared params, per-tool
options, a window, and an optional filter graph all work; `hey-listen analyzers`
lists the catalog and `hey-listen synth <g.json>` renders a fundsp graph before
analyzing it. It is the non-MCP sibling of the headless server — same engine, a
friendlier calling convention.

## For developers

The UI is a small, deliberate set of fixed regions, and the one rule worth
reading first: **Timeline, Sidebar, Workbench, and Source are fixed regions, not
tabs.** The only tabs are the **Workbench tabs** — the graph editors (filter /
synth) and the analyzer tools — and they live inside the Workbench (managed by
`dockview`). See [`docs/ui-layout.md`](docs/ui-layout.md).

Two processes, one boundary: a Rust core (full OS access — all audio I/O,
decode, analysis, the project file, and the cross-window UI state) and a SolidJS
frontend in the system WebView (layout, tabs, graph editing, charts). They talk
only over the Tauri IPC boundary; PCM crosses solely through ordered
`tauri::ipc::Channel` streams, and the structured IPC types are generated from
Rust with `ts-rs`, so the two sides can't drift. Analysis runs off the main
thread (async command + `spawn_blocking`), with debounced auto-run. Adding an
analysis tool is a registry entry plus its Rust function — no bespoke component.

Other rules worth knowing: expensive tools get an optional explicit **Run**;
there are **no duplicate analyzer tabs**; and shared analysis params are synced
across tools. See [`docs/architecture.md`](docs/architecture.md) for the full
picture.

## Documentation

`docs/` is the source of truth for design; keep it in sync when decisions change.
Start with the [architecture](docs/architecture.md) and
[roadmap](docs/roadmap.md), then the doc for the area you're touching.

- [Architecture](docs/architecture.md) — processes, IPC boundary, module layout, threading
- [UI layout](docs/ui-layout.md) — the fixed-region + Workbench-tabs rule
- [Graph editor](docs/graph-editor.md) — the fundsp Net model and node palette
- [Source model](docs/source-model.md) — audio sources and timeline behavior
- [Data model](docs/data-model.md) — domain entities and relationships
- [Project file format](docs/project-file-format.md) — binary layout and streaming
- [Analysis tools](docs/analysis-tools.md) — oxiaudio inventory, tool/tab model, shared params
- [MCP server](docs/mcp.md) — agent access, the stdio bridge, UI following
- [Batch CLI](docs/cli.md) — `hey-listen analyze`: bulk-analyze files from a shell, no window
- [Dependencies & licenses](docs/dependencies.md)
- [Packaging](docs/packaging.md) — release/CI process and the build matrix
- [Testing](docs/testing.md) — E2E plan and test matrix
- [Decisions (ADRs)](docs/decisions.md)
- [Roadmap](docs/roadmap.md) — phased milestones and status

## Build and dependencies

Requires Rust ≥ 1.90 and Node. Prefer the npm Tauri CLI over a `cargo`-installed
one (they drift; see [`docs/dependencies.md`](docs/dependencies.md)).

```sh
npm install
npm run tauri dev
```

Other scripts: `npm run dev` (Vite only), `npm run build`, `npm run typecheck`.
Run `cargo check` in `src-tauri/` for the Rust side — the first build is slow
(many deps). Run `cargo test` after changing a boundary type: it regenerates the
TypeScript bindings in `src/bindings/`.

The core stack: [Tauri 2](https://v2.tauri.app) +
[SolidJS](https://www.solidjs.com)/TypeScript/Vite, with
[`@kobalte/core`](https://kobalte.dev) primitives, [`dockview`](https://dockview.dev)
for the Workbench tabs, [`@dschz/solid-flow`](https://github.com/dsnchz/solid-flow)
for the graph editor, and [`@dschz/solid-uplot`](https://github.com/dsnchz/solid-uplot) +
`uplot` for charts. Audio in Rust: [`flexaudio`](https://crates.io/crates/flexaudio)
(capture), [`symphonia`](https://crates.io/crates/symphonia) (decode),
[`fundsp`](https://crates.io/crates/fundsp) (filter/synth), and
[`oxiaudio`](https://crates.io/crates/oxiaudio) (analysis). Full versions,
rationale, and licenses are in [`docs/dependencies.md`](docs/dependencies.md).

If `npm install` hits `EPERM` from a root-owned `~/.npm`, use a project-local
cache: `npm_config_cache=/Users/anvlkv/Projects/hey-listen/.npm-cache npm install`.
