# Hey Listen

Audio analysis workbench. Capture, filter, and analyze audio from files, live
inputs (mic / system / per-process / mix), and fundsp synthesis — then save the
source, analysis setup (including layout), and results into a single binary
project file.

> **Status:** launchable shell only. Dependencies are wired and the app builds
> and runs; no analysis features are implemented yet. See
> [`docs/roadmap.md`](docs/roadmap.md).

> **AI assistance:** This project was scaffolded and developed with the help of AI
> coding agents. AI-generated code and documentation should be reviewed before
> relying on it.

## Stack

- **Desktop shell:** [Tauri 2](https://v2.tauri.app) (Rust core + system WebView)
- **UI:** [SolidJS](https://www.solidjs.com) + TypeScript + Vite
- **Docking (Workbench tabs only):** [`dockview`](https://dockview.dev)
- **Graph editor (fundsp filter/synth):** [`@dschz/solid-flow`](https://github.com/dsnchz/solid-flow)
- **Charts:** [`@dschz/solid-uplot`](https://github.com/dsnchz/solid-uplot) + `uplot`
- **Audio (Rust):**
  - [`flexaudio`](https://crates.io/crates/flexaudio) — capture (mic / system / process / mix)
  - [`symphonia`](https://crates.io/crates/symphonia) — file decode / demux
  - [`fundsp`](https://crates.io/crates/fundsp) — filtering + synthesis nets
  - [`oxiaudio`](https://crates.io/crates/oxiaudio) — analysis

## Layout rule (read this first)

`Timeline`, `Sidebar`, and `Workbench` are **fixed regions** — they are **not**
tabs. The **only** tabs are analyzer tabs, and they live **inside the Workbench**
(managed by `dockview`). See [`docs/ui-layout.md`](docs/ui-layout.md).

## Develop

```sh
npm install
npm run tauri dev
```

Other scripts: `npm run dev` (Vite only), `npm run build`, `npm run typecheck`.

## Documentation

- [Architecture](docs/architecture.md)
- [UI layout](docs/ui-layout.md)
- [Source model](docs/source-model.md)
- [Data model](docs/data-model.md)
- [Project file format](docs/project-file-format.md)
- [Analysis tools](docs/analysis-tools.md)
- [Dependencies & licenses](docs/dependencies.md)
- [Decisions (ADRs)](docs/decisions.md)
- [Roadmap](docs/roadmap.md)
