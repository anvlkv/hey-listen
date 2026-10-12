# Dependencies

## Rust (`src-tauri/Cargo.toml`)

| Crate | Version | Purpose | License |
| --- | --- | --- | --- |
| `tauri` / `tauri-build` | 2 | desktop shell + build | MIT / Apache-2.0 |
| `tauri-plugin-dialog` | 2 | native open/save/confirm dialogs | MIT / Apache-2.0 |
| `tauri-plugin-window-state` | 2 | remember window size/position across launches | MIT / Apache-2.0 |
| `tauri-plugin-log` | 2 | file + stdout logging (rotated per session / size) | MIT / Apache-2.0 |
| `log` | 0.4 | log facade (Rust `log::info!` etc.) | MIT / Apache-2.0 |
| `flexaudio` | 0.3 | capture (mic/system/process/mix) | see crates.io |
| `symphonia` | 0.6 (`all`) | file decode / demux | MPL-2.0 |
| `fundsp` | 0.23 | filtering + synthesis nets | see crates.io |
| `cpal` | 0.16 | preview playback (output) | Apache-2.0 |
| `oxiaudio` | 0.2 (`serde`) | analysis | Apache-2.0 |
| `serde` / `serde_json` | 1 | serialization | MIT / Apache-2.0 |
| `postcard` | 1 | binary codec for the project file | MIT / Apache-2.0 |
| `thiserror` | 2 | error types | MIT / Apache-2.0 |
| `ts-rs` | 12 | generate the TypeScript bindings for the IPC boundary types (via `cargo test`) | MIT |

## Frontend (`package.json`)

| Package | Version | Purpose | License |
| --- | --- | --- | --- |
| `solid-js` | ^1.9 | UI | MIT |
| `@kobalte/core` | ^0.13 | accessible UI primitives (combobox, select, …) | MIT |
| `@tauri-apps/api` / `@tauri-apps/cli` | ^2 | IPC / CLI | MIT / Apache-2.0 |
| `@tauri-apps/plugin-log` | ^2 | forward frontend `console.*` to the core log (`attachConsole`) | MIT / Apache-2.0 |
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
  `tauri` crate accepts them. If you must use `cargo tauri`, keep it in step:
  `cargo install tauri-cli --version 2.12.1`.
- **Release / packaging (M7):** bundle with `npm run tauri build`; add GitHub
  release workflows and a build matrix covering the supported platforms.
- **Type exchange (ts-rs):** the structured IPC types are defined once in Rust with
  `#[derive(ts_rs::TS)]` + `#[ts(export)]`. `cargo test` regenerates their TypeScript
  definitions into `src/bindings/` (configured by `src-tauri/.cargo/config.toml`,
  `TS_RS_LARGE_INT = "number"`), and the frontend imports them — so the two sides
  cannot drift. Run `cargo test` after changing a boundary type.
- **MCP server (M9):** the loopback MCP server uses only `std::net` + `serde_json`
  (already a dependency) plus the Tauri event/command surface — **no new crates**.
  The `heylisten-mcp` bridge is a second binary in the same crate. See
  [`mcp.md`](mcp.md).
