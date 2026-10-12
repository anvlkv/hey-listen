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
`hey-listen --mcp`) is a dumb stdio ⇄ socket **bridge**, because MCP clients launch
a local server as a `command` + `args` and speak MCP over its stdio.

```text
 agent (Zed)              heylisten-mcp            Hey Listen (core + webview)
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

- The app binds an ephemeral `127.0.0.1` port at startup and advertises it (with a
  random token) in `mcp.json` under the app config dir
  (`~/Library/Application Support/com.anvlkv.heylisten/mcp.json` on macOS). The file
  is removed on exit.
- Every `tools/call` is forwarded to the **focused project window's** frontend as the
  `mcp:request` event; the frontend runs the tool through the same stores and
  `invoke` commands the UI uses and replies through the `mcp_respond` command. The
  server thread blocks on that reply, so a tool call is a normal request/response.
- A focused **popout** resolves to the project window that owns it, so a call never
  lands in a single-tool popout.

Because the tool runs in the window, **UI following is automatic**: `open_tool`
opens a Workbench tab, `run_analysis` opens the analyzer tab and sets the analysis
window, `open_audio_file` replaces the timeline — and `get_state` reports exactly
what the window shows. There is no second, headless code path **in this first cut**;
the follow-up below adds one.

## Configure it in Zed

1. **Run the app** (`npm run tauri dev`, or the built app). The bridge waits up to
   15 s for the app to advertise itself, but the app must be running to serve tools.
2. **Add a local MCP server** (Settings → AI → MCP Servers → *Add Server* → *Add
   Local Server*, or edit the settings file). Point it at the **app binary with
   `--mcp`** — no extra file to ship, so this also works for a bundled app:

   ```json
   {
     "context_servers": {
       "hey-listen": {
         "command": "/absolute/path/to/Hey Listen.app/Contents/MacOS/hey-listen",
         "args": ["--mcp"]
       }
     }
   }
   ```

   `--mcp` runs only the stdio ⇄ socket bridge (it never opens a window). On
   macOS/Linux the app binary is a normal program, so stdio works; **on Windows
   release use the standalone `heylisten-mcp` helper instead** (the app binary has no
   console there):

   ```json
   {
     "context_servers": {
       "hey-listen": {
         "command": "/absolute/path/to/hey-listen/src-tauri/target/debug/heylisten-mcp",
         "args": []
       }
     }
   }
   ```

   The helper is built alongside the app — `src-tauri/target/{debug,release}/heylisten-mcp`.
   Both entry points call the same `run_mcp()` bridge in the library.

3. The server's indicator turns green. Ask the agent to *"look at the current
   source"* or *"open the spectrogram and tell me the peak frequency"* — the window
   follows along.

## Tools

`tools/list` always answers (the catalog is static, in
`src-tauri/src/mcp/tools.rs`), even before a window is ready; the *handlers* live in
`src/state/mcp.ts`.

| Tool | Purpose |
| --- | --- |
| `get_state` | Observe: source shape, analysis window + viewport, shared params, tool options, open tabs, project name/path/dirty, filter + output settings. |
| `list_analyzers` | The analyzer catalog (id/title/description/section/keywords). |
| `open_audio_file` | Open a file source (`path`, `replace`). |
| `close_source` | Drop the source. |
| `render_synth` | Render the synth graph to a source (`seconds`, `replace`). |
| `run_analysis` | Open an analyzer tab and run it; optional `start`/`end`/`params`/`options`; `includeData` returns full arrays (default: compacted). |
| `set_analysis_window` | Set the region every analyzer runs over. |
| `set_view` | Set the timeline's visible range. |
| `set_shared_params` | Patch the shared analysis params. |
| `set_tool_options` | Patch one analyzer's own options. |
| `open_tool` / `close_tool` | Open / close a Workbench tab (analyzer id, `filter`, or `synth`). |
| `get_graph` | Read a graph editor's `{ nodes, edges }`. |
| `set_filter_graph` | Replace the filter graph and/or toggle it (`enabled`). |
| `set_synth_graph` | Replace the synth graph. |
| `preview` / `stop_preview` | Preview playback. |
| `set_output_gain` | Preview output gain. |
| `list_output_devices` / `list_input_devices` / `list_processes` | Enumerate devices / processes. |
| `start_capture` / `stop_capture` | Live capture (mic / system / process / mix). |
| `save_project` / `open_project` / `new_project` | Project file actions. |

`run_analysis` **compacts** its result by default (long numeric arrays become
`{ length, min, max }`, other long arrays their length) so a spectrogram does not
blow the agent's context; pass `includeData: true` for the raw result.

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

- The endpoint binds `127.0.0.1` only and requires a random token (advertised in the
  app config dir, readable by the user), so another local process cannot drive the
  app casually. There is no network exposure.
- The app drives the same commands the UI does; an agent cannot do anything the UI
  could not.
- File pickers and the "replace source?" / "discard changes?" prompts still belong
  to the UI. `open_audio_file` / `render_synth` accept `replace: true` to skip the
  replace prompt; other prompts (e.g. discard on `new_project`/`open_project`) are
  not triggered by those tools.

## Follow-up (planned)

Three scoped additions on top of the delivered server (see `docs/roadmap.md` → M9):

1. **In-app MCP control** — a Toolbar **MCP** popover:
   - **On/off toggle, default off.** Off = no listener and no `mcp.json`, so the
     bridge reports "MCP is off in Hey Listen (or the app isn't running)".
   - **Port input**, default `47100`; a free-port fallback and an inline "port in
     use" error (no `port_check` crate — the bind itself is the check).
   - A live status line (`127.0.0.1:PORT`) and a **copyable** Zed
     `context_servers` snippet rendered from `current_exe()` + `["--mcp"]` (plus the
     `heylisten-mcp` sibling), copied via `tauri-plugin-clipboard-manager`.
   - Persisted with `tauri-plugin-store` (read in `setup`, so the server starts in
     the right state before any window); single writer behind `get_mcp_status` /
     `set_mcp_config`.

2. **Headless MCP-only CLI** — `heylisten-mcp` becomes **auto-detecting**:
   - App running + MCP enabled → **bridge** to it (UI following, as today).
   - Otherwise → **headless core-native** server over stdio (no TCP, no window).
   - `--headless` forces the headless mode.
   - The headless subset reuses the engine (open file, run every analyzer,
     filter/synth, preview, enumerate, capture). UI-only tools (`open_tool` /
     `close_tool`, editor-layout graphs, `save_project` / `open_project`) answer
     "requires the app".
   - One shared engine path: the GUI commands and the headless dispatcher call the
     same extracted core functions (`analysis::run_window`, `decode::load_into`,
     `graph::install_filter`, `playback::preview_window`, …).

3. **Multi-project targeting** — `list_projects` plus an optional `target` argument
   on every tool, so one port addresses **any** of a process's project windows
   (`main` / `project-*` / popouts) instead of only the focused one. `get_state` also
   reports which project a call is looking at. Default remains the focused window.

Planned new files: `mcp/settings.rs`, `mcp/dispatch.rs`, `mcp/headless.rs`, the
`get_mcp_status`/`set_mcp_config` commands, `state/mcpSettings.ts`, the Toolbar
popover component, and an `l-mcp-ui.spec.ts` (plus headless CLI coverage).

## Limitations / deferred

- **One app instance per config dir.** The advertised port is a single file, so two
  simultaneously running instances would race for it (last writer wins). The bridge
  connects to whoever last advertised.
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
- **MCP resources / prompts / elicitation** are not implemented (tools only), which
  is what the milestone scoped.

## Files

| Path | Role |
| --- | --- |
| `src-tauri/src/mcp/mod.rs` | module root: constants, the `Pending` request/response map. |
| `src-tauri/src/mcp/protocol.rs` | JSON-RPC + MCP method surface (pure, unit-tested). |
| `src-tauri/src/mcp/tools.rs` | the static tool catalog (names + JSON schemas). |
| `src-tauri/src/mcp/server.rs` | the loopback server + forwarding to the frontend. |
| `src-tauri/src/mcp/bridge.rs` | the stdio ⇄ socket bridge. |
| `src-tauri/src/commands/mcp.rs` | the `mcp_respond` command. |
| `src/state/mcp.ts` | the tool handlers (run against the app's stores). |
| `e2e/specs/k-mcp.spec.ts` | end-to-end coverage over the real endpoint. |
