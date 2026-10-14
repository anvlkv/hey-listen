# MCP server (agent access + UI following)

**M9.** Hey Listen exposes a
[Model Context Protocol](https://modelcontextprotocol.io) server so an AI agent can
drive the app: open a source, run every analysis tool, edit the filter / synth
graphs, preview playback, and save/load projects. Crucially, an agent drives the
**same surface the UI drives, not a parallel one** — and it drives the *running*
project, so agent actions appear in the live window and the window's state is what
the agent observes.

## Shape

The MCP **server lives in the app process** (it needs the app's state and the
webview), and exposes a loopback TCP endpoint. The `heylisten-mcp` binary (or
`hey-listen --mcp`) is a stdio ⇄ socket **bridge**, because MCP clients launch
a local server as a `command` + `args` and speak MCP over its stdio.

```text
 agent (MCP)              heylisten-mcp            Hey Listen (core + webview)
 ┌──────────┐  stdio MCP  ┌──────────────┐  TCP   ┌────────────────────────────┐
 │  client  │ ──────────► │    bridge    │ ─────► │ mcp::server (127.0.0.1)    │
 └──────────┘ ◄────────── └──────────────┘ ◄───── └─────────────┬──────────────┘
                                                                │ mcp:request
                                                                ▼
                                                       window frontend (state/mcp.ts)
                                                                │ runs the tool
                                                                │ mcp_respond
                                                                ▼
```

- The server is **off by default**. Turn it on from the Toolbar **MCP** popover
  (or `set_mcp_config`); it then binds a loopback port (the configured one, default
  `47100`, falling back to a free port if that is taken) and advertises it (with a
  random token) in `mcp.json` under the app **data** dir
  (`~/Library/Application Support/com.anvlkv.heylisten/mcp.json` on macOS, beside the
  `mcp-settings.json` store file). The file is removed when the server stops.
- Every `tools/call` is forwarded to the **focused project window's** frontend as the
  `mcp:request` event (or to the window named by an optional `target` — see
  *Multi-project* below); the frontend runs the tool through the same stores and
  `invoke` commands the UI uses and replies through the `mcp_respond` command. The
  server thread blocks on that reply, so a tool call is a normal request/response.
- A focused **popout** resolves to the project window that owns it, so a call never
  lands in a single-tool popout.
- The transport **blocks in `accept()`** rather than polling: the thread parks until the
  kernel hands it a connection, and `McpController::stop` wakes it with a bare loopback
  connection (which reads EOF, so it is never mistaken for a client). A poll-and-sleep
  loop used to lose seconds per connection whenever macOS deferred its timer.
- **The app is normally in the background** while it serves. An MCP client drives the
  app from *another* application, so Hey Listen usually sits behind it — and macOS
  **App Nap** coalesces a background app's timers, lowers its priority, and can suspend
  it. Two layers opt out: the bundle's `Info.plist` sets `NSAppSleepDisabled`
  (`src-tauri/Info.plist`, merged by Tauri) and the process asserts a **user-initiated
  activity** at startup (`src-tauri/src/app_activity.rs` → `NSProcessInfo.beginActivity`),
  which also covers dev builds and bare executables. The same applies to live capture,
  which would otherwise stall in the background.

Because the tool runs in the window, **UI following is automatic**: `open_tool`
opens a Workbench tab, `run_analysis` opens the analyzer tab and sets the analysis
window, `open_audio_file` replaces the timeline — and `get_state` reports exactly
what the window shows. When **no app is running**, the same command line falls back
to a **core-native headless** server instead (see *Headless CLI* below).

## Configure it in your MCP client

1. **Turn MCP on** in the app: open the Toolbar **MCP** popover, switch it on, and
   pick a port (default `47100`; a busy port falls back to a free one with an inline
   note). A live status line shows the endpoint — e.g. `127.0.0.1:47100` — and the port
   field shows the same (the port actually in effect). The setting is persisted (it
   comes back on the next launch).
2. **Copy the config** with the popover's **Copy** button — it renders a ready-to-paste
   snippet in the common `mcpServers` shape from the app's own paths; paste it into
   your client's MCP server settings. By default it points at the **app binary with
   `--mcp`** — no extra file to ship, so this also works for a bundled app:

   ```json
   {
     "mcpServers": {
       "hey-listen": {
         "command": "/absolute/path/to/Hey Listen.app/Contents/MacOS/hey-listen",
         "args": ["--mcp"]
       }
     }
   }
   ```

   `--mcp` runs the stdio MCP entry and never opens a window. On macOS/Linux the app
   binary is a normal program, so stdio works; **on Windows release use the standalone
   `heylisten-mcp` helper instead** (the app binary has no console there). The popover
   offers both, when the helper exists next to the app binary:

   ```json
   {
     "mcpServers": {
       "hey-listen": {
         "command": "/absolute/path/to/hey-listen/src-tauri/target/debug/heylisten-mcp",
         "args": []
       }
     }
   }
   ```

   The helper is built alongside the app — `src-tauri/target/{debug,release}/heylisten-mcp`.
   Both entry points call the same `mcp::run`, which auto-detects bridge vs headless.

3. The server's indicator turns green. Ask the agent to *"look at the current
   source"* or *"open the spectrogram and tell me the peak frequency"* — the window
   follows along.

> **No app? No problem.** If Hey Listen is not running, the same command line serves
> the **compute tools** headlessly (see *Headless CLI*). So an agent can analyze files
> with nothing open — and start using the UI tools the moment the app is up.

## Tools

`tools/list` always answers (the catalog is static, in
`src-tauri/src/mcp/tools.rs`), even before a window is ready; the *handlers* live in
`src/state/mcp.ts`.

| Tool | Purpose |
| --- | --- |
| `get_state` | Observe: source shape, analysis window + viewport, shared params, tool options, open tabs, project name/path/dirty, filter + output settings, and the **notes** + focused note id. |
| `list_analyzers` | The analyzer catalog (id/title/description/section/keywords). |
| `open_audio_file` | Open a file source (`path`, `replace`). |
| `close_source` | Drop the source. |
| `render_synth` | Render the synth graph to a source (`seconds`, `replace`). |
| `run_analysis` | Run an analyzer over the analysis window; optional `start`/`end`/`params`/`options`; `display: false` computes without opening a tab; `transient` applies the overrides for one call only; `includeData` returns full arrays (default: compacted), `maxPoints` decimates them. |
| `set_analysis_window` | Set the region every analyzer runs over. |
| `set_view` | Set the timeline's visible range. |
| `set_shared_params` | Patch the shared analysis params. |
| `set_tool_options` | Patch one analyzer's own options. |
| `open_tool` / `close_tool` | Open / close a Workbench tab (analyzer id, `filter`, or `synth`). |
| `get_graph` | Read a graph editor's `{ nodes, edges }`. |
| `set_filter_graph` | Replace the filter graph and/or toggle it (`enabled`). In headless mode takes a `GraphSpec` directly. |
| `set_synth_graph` | Replace the synth graph. |
| `preview` / `stop_preview` | Preview playback. |
| `set_output_gain` | Preview output gain. |
| `list_output_devices` / `list_input_devices` / `list_processes` | Enumerate devices / processes. |
| `start_capture` / `stop_capture` | Live capture (mic / system / process / mix). |
| `save_project` / `open_project` / `new_project` | Project file actions. |
| `list_projects` | List the open project windows (label, name, focused) — answered by the server. |
| `list_notes` / `get_note` / `create_note` / `update_note` / `delete_note` / `set_focused_note` | The project's **notes**: read/write the markdown annotations anchored to a time (+ optional range) and an analyzer tool; `create_note` captures the chart's frozen values, `update_note` can `recomputeValues`, and `set_focused_note` highlights one on every time-based chart. **App-only** (a note lives in a project; headless answers "requires the app"). **(M14)** |
| `list_themes` / `get_theme` / `set_theme` | The theme registry (bundled + installed) and the active theme (mode + dark/light slots); `import_theme` / `export_theme` are file operations. Headless reports the bundled themes only. |
| `export_analysis` / `export_chart` / `export_all` | Save an analyzer's data (JSON / CSV) or chart (PNG), or every open tool to a folder. `export_analysis` is headless-capable; `export_chart` needs the rendered canvas. **(M12, planned)** |
| `list_templates` / `apply_template` / `save_template` / `export_template` / `import_template` | Installed analysis templates; apply to the current project or the headless session. **(M13, planned)** |

`run_analysis` **compacts** its result by default so a spectrogram does not blow the
agent's context: a long numeric array becomes `{ length, min, max, argmin, argmax }`; a
long array with gaps (`null`s, e.g. a pitch track's unvoiced frames) becomes
`{ length, nulls, min, max, argmin, argmax }` over the present numbers, so a nearly-empty
track is visible at a glance; and any other long array becomes `{ length }`. `argmin` /
`argmax` locate the peak without pulling every frame. Pass `includeData: true` for the
raw result, and `maxPoints: N` to decimate the returned arrays to ≤ N points (by striding,
keeping the first and last).

**`target`.** Every tool accepts an optional `target` (a label from `list_projects`)
to address a specific project window instead of the focused one. `get_state` reports
the window it is looking at as `project.window`. With no app running, the headless
server answers the compute subset (the rest return "requires the app").

## Protocol notes

- JSON-RPC 2.0, newline-delimited, over loopback TCP (after a token handshake) —
  the same framing MCP uses over stdio, so the bridge is a byte pump.
- `initialize` echoes the client's requested `protocolVersion` (so newer clients
  negotiate their own revision) and advertises the `tools` capability only.
- `tools/call` returns a `CallToolResult`: the payload as `content[0].text` (pretty
  JSON) plus `structuredContent` for object results. A tool failure is a
  *successful* result with `isError: true`, so the agent sees the message in the
  conversation.
- The server answers `resources/list` / `prompts/list` emptily (it advertises
  neither) and ignores notifications.

## Security

- The server is **off by default** — nothing listens until the user enables it.
- The endpoint binds `127.0.0.1` only and requires a random token (advertised in the
  app data dir, readable by the user), so another local process cannot drive the app
  casually. There is no network exposure.
- The app drives the same commands the UI does; an agent cannot do anything the UI
  could not.
- File pickers and the "replace source?" / "discard changes?" prompts still belong
  to the UI. `open_audio_file` / `render_synth` accept `replace: true` to skip the
  replace prompt; other prompts (e.g. discard on `new_project`/`open_project`) are
  not triggered by those tools.

## Control, headless CLI, multi-project

Three additions on top of the delivered server (see `docs/roadmap.md` → M9):

1. **In-app MCP control** — the Toolbar **MCP** popover:
   - **On/off toggle, default off.** Off = no listener and no `mcp.json`, so the
     bridge falls through to the headless server (or reports that MCP is off).
   - **Port input**, default `47100`; a busy port falls back to a free port and the
     popover shows an inline note (no `port_check` crate — the bind itself is the
     check).
   - A live status line (`127.0.0.1:PORT`) and a **copyable** `mcpServers` snippet
     rendered from `current_exe()` + `["--mcp"]` (with a toggle for the
     `heylisten-mcp` sibling when it exists), copied via
     `tauri-plugin-clipboard-manager`. The port field shows the **port in effect**
     (the bound one), so it never disagrees with the status line when the configured
     port is `0`/auto or has fallen back.
   - Persisted with `tauri-plugin-store` in `mcp-settings.json`, read in `setup` (so
     the server starts in the right state before any window) and written only through
     `get_mcp_status` / `set_mcp_config` (`McpController` is the single writer).

2. **Headless MCP-only CLI** — `heylisten-mcp` (and `hey-listen --mcp`) **auto-detects**:
   - A running, MCP-enabled app advertising its endpoint → **bridge** to it (UI
     following, as delivered).
   - Otherwise → a **core-native** MCP server over stdio (no TCP, no window).
   - `--headless` forces the headless mode (skips the probe).
   - The headless subset is the **engine-backed compute surface**: `get_state`,
     `list_analyzers`, `open_audio_file`, `close_source`, `render_synth` (with an
     explicit `graph`), `set_filter_graph` (with an explicit `GraphSpec`),
     `run_analysis`, `set_analysis_window`, `set_view`, `set_shared_params`,
     `set_tool_options`, and the `list_*` enumerations — plus the **data** halves of
     the export / template tools (`export_analysis`, `list_templates`,
     `apply_template`) once M12/M13 land.
     UI-only tools — Workbench tabs, the editor-layout graphs (`get_graph` /
     `set_synth_graph`), project save/load, and live preview/capture (real device I/O
     with no UI to configure it) — answer "requires the app".
   - One shared engine path: the GUI command and the headless dispatcher both call
     `analysis::run_window` (the slice + condition + run logic that used to live in
     `commands/analysis.rs`), and the other engines (`audio::decode`, `audio::graph`,
     `audio::analyzers`) directly — so there is no second DSP path.

3. **Multi-project targeting** — `list_projects` (answered by the server from its
   window inventory) plus an optional `target` argument injected into **every** tool's
   schema, so one port addresses **any** of a process's project windows (`main` /
   `project-*` / popouts) instead of only the focused one. The server strips `target`
   and routes the call; a popout label resolves to its owning project window;
   `get_state` reports the window a call is looking at (`project.window`). The default
   remains the focused window.

## Follow-up: result fidelity + agent ergonomics

Driving the server exploratorily — a dozen `run_analysis` calls to profile one source —
exposed rough edges in **result shape and side effects**. Delivered as *M9 follow-up 2*
(see [`roadmap.md`](roadmap.md)):

1. **Compute without display.** `run_analysis` takes a `display` argument (default
   `true`). `display: false` computes and returns the result **without opening or
   focusing** the analyzer tab, so a sweep no longer leaves a Workbench tab per tool.
   Headless is display-less already, so it is a no-op there.
2. **Honest compaction.** A long numeric array → `{ length, min, max, argmin, argmax }`;
   a long array with gaps → `{ length, nulls, min, max, argmin, argmax }` over the present
   numbers. "One voiced frame out of 511" is now visible at a glance (`nulls: 510`). The
   two implementations stay in step: `src/state/mcp.ts` (`compact`) and
   `src-tauri/src/mcp/dispatch.rs` (`compact`), with a matching Rust unit test.
3. **Bounded `includeData`.** A `maxPoints` argument decimates the returned arrays to ≤ N
   points by striding (keeping the first and last), so `includeData` need not dump every
   frame.
4. **Echo + transient.** `run_analysis` echoes the **effective** `params` / `options` it
   ran with, and a `transient` argument (default `false`) applies `start` / `end` /
   `params` / `options` for that call only instead of writing them back to the project —
   a `params` override no longer mutates the shared params silently.

Plus **hygiene**: the envelope no longer repeats the `tool` tag (the analysis result
carries it) and the source summary drops the opaque `detail` — for a file that was a
symphonia codec id that could render as a bare `0x1006`, useless to an agent. The `hop`
field's schema now states it is a **fraction of `fftSize`** (`0.25` = 75% overlap, not a
sample count).

**`voicedFrames` / `voicedFraction`.** The three pitch tools now return a `PitchResult`
(the f0 series plus a voiced-frame summary), so a tracker that finds almost no voiced
frames (a near-empty track) is self-evident rather than looking like a normal success.

**pYIN spike (open).** `pitchPyin` returned a single voiced frame on the Blue-capped
Ifrit clip while YIN and autocorrelation tracked normally. The detector itself lives in
the external `oxiaudio` crate, so it cannot be fixed from here; the voiced-frame summary
at least surfaces the undercount. Tracked as a separate spike in [`roadmap.md`](roadmap.md).

## Limitations / deferred

- **One app instance per data dir.** The advertised port is a single file, so two
  simultaneously running instances would race for it (last writer wins). The bridge
  connects to whoever last advertised.
- **Headless is the compute subset.** `heylisten-mcp --headless` runs analyzers over
  files, enumerates devices, and can install a compute filter (`set_filter_graph` with a
  `GraphSpec`), but cannot open Workbench tabs, edit the editor-layout graphs
  (`get_graph` / `set_synth_graph`), save/load projects, or drive live preview/capture —
  those need the app. The headless orchestration is a second (thin) dispatcher that must
  stay in step with the GUI handlers for the tools it covers. For scripting without an
  MCP client at all, use the batch CLI instead — [`cli.md`](cli.md) (`hey-listen
  analyze`), which drives the same headless session from a shell and prints JSON.
- **Themes are chrome.** `list_themes` / `get_theme` work headless, but only for the
  **bundled** themes (`src-tauri/src/themes.rs` → `BUILTIN_THEMES`) — headless has no
  webview to run the TS registry and cannot resolve the app config dir, so installed
  themes, the active mode, and `set_theme` / `import_theme` / `export_theme` need the
  app. With the app running they run in the webview against the same registry the UI
  drives (see [`theming.md`](theming.md)).
- **Result caching is still deferred** (`RESULTS` is written empty), so `run_analysis`
  always recomputes.
- **Windows release:** use `heylisten-mcp` (the app binary has no console).
- **Bundling the bridge:** the `heylisten-mcp` binary is built next to the app
  (`target/{debug,release}/heylisten-mcp`) but is **not** shipped inside the
  `.app`/installer. There is no need to: point the client at the **app binary with
  `--mcp`** instead (macOS/Linux work as-is, and no extra file is needed).
  Tauri's `bundle.externalBin` ("sidecar") is *not* the right tool here: it copies a
  **prebuilt** binary you stage per target triple (`binaries/heylisten-mcp-<triple>`)
  and is meant to be *spawned by the app* under `shell:allow-execute`, not launched by
  an external MCP client. Shipping a helper *inside* the bundle would need an
  `externalBin` entry **plus** a build step that runs `cargo build --bin heylisten-mcp`
  for the target triple and stages it under `src-tauri/binaries/` — deferred until it
  is actually needed.
- **`--mcp` on the app binary** runs the entry in `setup` (routed by
  `tauri-plugin-cli`), so the app process starts before the bridge does; it never opens
  a window, but for a GUI-less host (or Windows release) prefer `heylisten-mcp`, which
  is a plain console binary.
- **MCP resources / prompts / elicitation** are not implemented (tools only), which
  is what the milestone scoped.

## Files

| Path | Role |
| --- | --- |
| `src-tauri/src/mcp/mod.rs` | module root: constants, the `Pending` request/response map, `run` (the auto-detecting stdio entry). |
| `src-tauri/src/mcp/protocol.rs` | JSON-RPC + MCP method surface (pure, unit-tested). |
| `src-tauri/src/mcp/tools.rs` | the static tool catalog (names + JSON schemas + the shared `target`). |
| `src-tauri/src/mcp/server.rs` | the loopback transport, `list_projects`, and the `target` routing. |
| `src-tauri/src/mcp/settings.rs` | `McpConfig` / `McpStatus` + the `McpController` (persist + start/stop/rebind). |
| `src-tauri/src/mcp/bridge.rs` | the stdio ⇄ socket bridge + the advertisement probe. |
| `src-tauri/src/mcp/dispatch.rs` | the headless session: the engine subset (no window); the shared `set_filter_graph`. |
| `src-tauri/src/mcp/headless.rs` | the headless stdio loop. |
| `src-tauri/src/cli/mod.rs` | the `tauri-plugin-cli` flags (`--mcp` / `--headless`) + the batch subcommand routing. |
| `src-tauri/src/cli/batch.rs` | the batch CLI (`analyzers` / `analyze` / `synth`) over the headless session. |
| `src-tauri/src/app_activity.rs` | the macOS user-initiated activity (opts out of App Nap). |
| `src-tauri/Info.plist` | macOS bundle additions — `NSAppSleepDisabled` (opts out of App Nap). |
| `src-tauri/src/audio/analyzers.rs` | the Rust analyzer catalog for headless `list_analyzers`. |
| `src-tauri/src/commands/mcp.rs` | `mcp_respond` / `mcp_ready` and `get_mcp_status` / `set_mcp_config`. |
| `src/state/mcp.ts` | the GUI tool handlers (run against the app's stores). |
| `src/state/mcpSettings.ts` | the popover's view over the MCP status + the snippet/copy helpers. |
| `src-tauri/src/themes.rs`, `src-tauri/src/commands/themes.rs` | the theme-file store + commands (M11). |
| `src/lib/themeFile.ts`, `src/state/themes.ts` | the `ThemeFile` model + the theme registry / apply pipeline, and the GUI theme MCP handlers (in `src/state/mcp.ts`) (M11). |
| `src-tauri/src/templates.rs`, `src-tauri/src/commands/templates.rs` | the template store + commands (M13, planned). |
| `src-tauri/src/commands/export.rs` | output plumbing (`pick_save_path` / `write_text` / `write_bytes`) (M12, planned). |
| `src/components/McpPopover.tsx` | the Toolbar MCP popover. |
| `e2e/specs/k-mcp.spec.ts` | end-to-end coverage over the real endpoint. |
| `e2e/specs/l-mcp-ui.spec.ts` | the popover: toggle, status, port, busy-port note, copy. |
| `src-tauri/tests/headless_mcp.rs` | the headless CLI integration test (spawns the binary). |
