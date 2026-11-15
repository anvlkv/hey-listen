# MCP server (bridge + headless)

The MCP server is an agent-facing interface over the same engine the app uses. Every
tool takes an optional `target` (a label from `list_projects`) to address a specific
project window instead of the focused one.

## Entry points + configure

Two binaries run the same `mcp::run`, auto-detecting bridge vs headless:

- **App binary with `--mcp`** — preferred on macOS/Linux. Never opens a window.
- **`heylisten-mcp` helper** — a console binary next to the app (`heylisten-mcp`); required on Windows release and on GUI-less hosts. `--headless` (with `--mcp`) forces headless, skipping the app probe.

Turn the server on in the Toolbar **MCP** popover (default port `47100`), then its
**Copy** button gives the `mcpServers` JSON to paste into your client.

## Bridge vs headless

- **App running + MCP on** → each `tools/call` is forwarded to the **focused window's**
  frontend and runs through the same stores/commands the UI uses; the UI follows
  (`open_tool` opens a tab, `open_audio_file` replaces the timeline, `get_state` reports
  what the window shows).
- **No app** → the same command falls back to a **core-native headless** server over
  stdio (no TCP, no window), covering the engine-backed compute subset.

## Tool inventory

`tools/list` always answers (static catalog). Compute tools work headless and bridged;
the rest answer *"requires the app"* headless.

| Group | Tools | Headless? |
| --- | --- | --- |
| Observe | `get_state`, `list_analyzers`, `get_analyzer` | yes |
| Source | `open_audio_file`, `close_source`, `render_synth`, `list_input_devices`, `list_output_devices`, `list_processes` | yes |
| Analyze | `run_analysis`, `set_analysis_window`, `set_view`, `set_shared_params`, `set_tool_options`, `set_filter_graph` | yes |
| Tabs | `open_tool`, `close_tool` | yes — headless they maintain `SETUP.openTools` (no webview), which `save_project` writes and the app restores |
| Project | `save_project`, `open_project`, `new_project` | yes (source + setup + annotations + `openTools`; parent folders created) |
| Project window | `open_project_window` | app-only (opens/raises a window at a `.heyl`, returns its label) |
| Compare | `compare_analysis`, `list_projects` | `compare_analysis` yes: a project **path** headless, a live label bridged, or `saved: true`; `list_projects` is answered by the server |
| Export (data) | `export_analysis`, `export_all` | yes (`export_all` headless takes an explicit `tools` list) |
| Graphs | `get_graph`, `set_synth_graph` | app-only (editor layouts) |
| Preview/capture | `preview`, `stop_preview`, `set_output_gain`, `start_capture`, `stop_capture` | app-only |
| Annotations | `list_annotations`, `get_annotation`, `create_annotation`, `update_annotation`, `delete_annotation`, `set_selected_annotation` | app-only (but `save_project` writes the `annotations` you pass headless) |
| Export (chart) | `export_chart` | app-only (needs the rendered canvas) |
| Themes | `list_themes`, `get_theme`, `set_theme`, `import_theme`, `export_theme` | headless lists bundled only |

Templates (M13) are planned and **not yet** exposed as tools.

> **Operational note:** the mutating tools (`open_tool` / `close_tool` / `set_*` /
> `create_annotation`) read-modify-write shared project state. Call them **sequentially**,
> not in parallel, or updates are lost (each call's reply reflects its own read of the
> state, and the last writer wins).

## Run, read, compare

`run_analysis` is described in the root workflow. `compare_analysis` diffs the **same**
analyzer on two sides:

- `with` — a project label from `list_projects` (bridged), a **project file path**
  (`.heyl`, headless), or `saved: true` to use the owner's stored reference snapshot.
- `bOffset` (seconds) shifts the reference on the relative axis; `includeData` /
  `maxPoints` / `axis` / `summaryOnly` shape the sides and delta exactly like
  `run_analysis`. B is **read-only**.
- The last successful comparison is stored in the owner, so `save_project` writes it into
  `COMPARE` and the app reopens it as a compare tab. `list_projects` reports each
  project's `savedComparisons`; headless `get_state` reports `savedComparisons` +
  `openTools`.

## Projects, tabs, comparisons from a script

A project = source + `SETUP` (window, params, options, `openTools`) + `LAYOUT` (graphs,
filter, popouts) + annotations + saved comparison snapshots. All scriptable; nothing
below opens a window.

**Headless MCP (no app)** — one session, one project:

```text
open_audio_file { path }                  # or render_synth { graph, seconds }
set_analysis_window { start, end }        # optional
transient / params / options              # same overrides as run_analysis
set_filter_graph { graph, enabled: true } # a GraphSpec (no editor headless)
open_tool { tool: "spectrum" }            # repeat; records SETUP.openTools
compare_analysis { tool, with: "/abs/reference.heyl", summaryOnly: true }
                                          # stores the reference snapshot in the session
save_project { path, openTools: [...], annotations: [...], embedSource: true }
                                          # creates parent dirs; writes COMPARE too
get_state                                 # → openTools + savedComparisons + window/params
```

`open_project { path }` loads a project's tabs/comparison into the session, and
`compare_analysis { saved: true }` re-runs against the loaded snapshot.

**Bridged MCP (app running)** — two live windows:

```text
open_project_window { path: "/abs/reference.heyl" }   # → { label, path, reused }
list_projects                                          # wait until that label is ready
compare_analysis { tool, with: "<label>" }             # live A/B, UI follows
save_project { path }                                  # saves the live tabs + comparison
```

Re-read a project's saved comparison with `compare_analysis { saved: true }` (one window).

## Data + chart export

- `export_analysis { tool, path?, format: json|csv }` — one analyzer as a self-describing
  JSON provenance envelope or a wide-matrix CSV (`<name>.meta.json` sidecar). Omit
  `path` to get the serialized `text` back without writing a file.
- `export_all { dir, formats }` — every open tab (or, headless, an explicit `tools`
  list) to a folder, one file per tool.
- `export_chart { tool, path }` — one tab's rendered chart as PNG (app-only).
- **Exports capture the current analysis window** — `set_analysis_window` first (see the
  root "Gotchas").

## Auditioning (app-only)

`preview { start?, end? }` plays the analysis window (or the given range) through the
core; it **loops by default** and accepts `speed` (0.25–4, pitch-shifting) and `loop`.
To audition a candidate loop, `set_analysis_window` to it and `preview`.

## What still needs the app

Bridged MCP is needed for **visual** work: Workbench tabs that render, editor-layout
graph editing (`get_graph` / `set_synth_graph`), live preview/capture, annotations
(`create_annotation` & co.), chart-image export, and a live two-window comparison.
Everything else is scriptable without a window. The CLI never bridges to a running app,
and `open_project_window` is the one app-only tool that deliberately creates a window.
