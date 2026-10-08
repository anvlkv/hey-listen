# Dependencies

## Rust (`src-tauri/Cargo.toml`)

| Crate | Version | Purpose | License |
| --- | --- | --- | --- |
| `tauri` / `tauri-build` | 2 | desktop shell + build | MIT / Apache-2.0 |
| `flexaudio` | 0.3 | capture (mic/system/process/mix) | see crates.io |
| `symphonia` | 0.6 (`all`) | file decode / demux | MPL-2.0 |
| `fundsp` | 0.23 | filtering + synthesis nets | see crates.io |
| `cpal` | 0.16 | preview playback (output) | Apache-2.0 |
| `oxiaudio` | 0.2 (`serde`) | analysis | Apache-2.0 |
| `serde` / `serde_json` | 1 | serialization | MIT / Apache-2.0 |
| `postcard` | 1 | binary codec for the project file | MIT / Apache-2.0 |
| `thiserror` | 2 | error types | MIT / Apache-2.0 |

## Frontend (`package.json`)

| Package | Version | Purpose | License |
| --- | --- | --- | --- |
| `solid-js` | ^1.9 | UI | MIT |
| `@kobalte/core` | ^0.13 | accessible UI primitives (combobox, select, …) | MIT |
| `@tauri-apps/api` / `@tauri-apps/cli` | ^2 | IPC / CLI | MIT / Apache-2.0 |
| `dockview` | ^8 | Workbench docking (tabs) | MIT |
| `@dschz/solid-flow` | ^0.2 | fundsp graph editor | MIT |
| `@dschz/solid-uplot` | ^0.5 | charts | MIT |
| `uplot` | ^1.6 | chart engine | MIT |
| `vite` / `vite-plugin-solid` / `typescript` | — | build / tooling | MIT / MIT / Apache-2.0 |

## License notes

- **symphonia is MPL-2.0** (file-level copyleft): fine to link against; any
  *modified* symphonia source files must be published under MPL-2.0. No planned
  modifications.
- **oxiaudio** `pure` feature set is Apache-2.0; MP3 **encode** is excluded from
  the facade (separate LGPL crate) — not used.
- Confirm exact `flexaudio` / `fundsp` license strings from their `Cargo.toml`
  before any redistribution.

## MSRV

Core crates require Rust ≥ 1.85 (`flexaudio`, `symphonia`); the `flexaudio-vad` /
`flexaudio-encode` add-ons (not yet used) require ≥ 1.91. Toolchain in use:
1.99.

## Tooling notes

- **Prefer the npm CLI** (`npm run tauri dev` / `npm run tauri build`) over a
  `cargo install`ed `cargo tauri`. The two can drift apart: the npm CLI tracks
  `@tauri-apps/cli` (2.12.x) while a cargo-installed `tauri-cli` may be older
  (e.g. 2.8.4). An older CLI validates `tauri.conf.json` against *its own* older
  schema and rejects newer keys (e.g. `bundle > macOS > infoPlist`) even though
  the `tauri` crate accepts them. If you must use `cargo tauri`, keep it in step:
  `cargo install tauri-cli --version 2.12.1`.
