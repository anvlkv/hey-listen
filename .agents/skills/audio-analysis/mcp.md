# MCP server (bridge + headless)

Agent-facing interface over the engine the app uses. Every tool takes an optional
`target` (a label from `list_projects`) to address a specific window instead of the focused
one.

## Entry points

- **App binary with `--mcp`** — preferred on macOS/Linux. No window.
- **`heylisten-mcp`** — console binary; required on Windows release and GUI-less hosts.
  `--headless` (with `--mcp`) forces headless, skipping the app probe.

Turn the server on in the Toolbar **MCP** popover; its **Copy** button gives the
`mcpServers` JSON to paste into your client.

## Bridge vs headless

- **App running + MCP on** → each `tools/call` runs through the same stores/commands the UI
  uses; the UI follows (`open_tool` opens a tab, `open_audio_file` replaces the timeline).
- **No app** → falls back to a **core-native headless** server (no window), covering the
  compute subset.

`get_state.server.mode` reports `bridge` or `headless`.

## Tool inventory

`tools/list` always answers. Compute tools work headless and bridged; the rest answer
*"requires the app"* headless.

| Group | Tools | Headless? |
| --- | --- | --- |
| Observe | `get_state`, `list_analyzers`, `get_analyzer` | yes |
| Source | `open_audio_file`, `close_source`, `render_synth`, `list_input_devices`, `list_output_devices`, `list_processes` | yes |
| Analyze | `run_analysis`, `set_analysis_window`, `set_view`, `set_shared_params`, `set_tool_options`, `set_filter_graph` | yes |
| Tabs | `open_tool`, `close_tool` | yes — headless they maintain `SETUP.openTools`, which `save_project` writes |
| Project | `save_project`, `open_project`, `new_project` | yes (source + setup + annotations + `openTools`; parents created) |
| Project window | `open_project_window` | app-only (opens/raises a window at a `.heyl`, returns its label) |
| Compare | `compare_analysis`, `list_projects` | `compare_analysis` yes (project **path** headless, live label bridged, or `saved: true`) |
| Export (data) | `export_analysis`, `export_all` | yes (`export_all` headless takes an explicit `tools` list) |
| Graphs | `get_graph`, `set_synth_graph` | app-only |
| Preview/capture | `preview`, `stop_preview`, `set_output_gain`, `start_capture`, `stop_capture` | app-only |
| Annotations | `list_annotations`, `get_annotation`, `create_annotation`, `update_annotation`, `delete_annotation`, `set_selected_annotation` | app-only (but `save_project` writes the `annotations` you pass headless) |
| Export (chart) | `export_chart` | app-only (needs the rendered canvas) |
| Themes | `list_themes`, `get_theme`, `set_theme`, `import_theme`, `export_theme` | headless lists bundled only |

Templates (M13) are planned, not yet exposed.

## Run, read, compare

`compare_analysis` diffs the **same** analyzer on two sides:

- `with` — a project label from `list_projects` (bridged), a project **file path** (`.heyl`,
  headless), or `saved: true` for the owner's stored snapshot.
- `bOffset` (seconds) shifts the reference on the relative axis; `includeData` / `maxPoints`
  / `axis` / `summaryOnly` shape the sides and delta like `run_analysis`. B is read-only.
- The last successful comparison is stored in the owner; `save_project` writes it to
  `COMPARE` and the app reopens it as a compare tab.

## Projects, tabs, comparisons from a script

A project = source + `SETUP` (window, params, options, `openTools`) + `LAYOUT` (graphs,
filter, popouts) + annotations + saved comparison snapshots. All scriptable; nothing below
opens a window.

**Headless (no app)** — one session, one project:

```text
open_audio_file { path }                  # or render_synth { graph, seconds }
set_analysis_window { start, end }        # optional
# transient / params / options             # same overrides as run_analysis
set_filter_graph { graph, enabled: true } # a GraphSpec (no editor headless)
open_tool { tool: "spectrum" }            # repeat; records SETUP.openTools
compare_analysis { tool, with: "/abs/reference.heyl", summaryOnly: true }
save_project { path, openTools: [...], annotations: [...], embedSource: true }
get_state                                 # → openTools + savedComparisons + window/params
```

`open_project { path }` loads a project's tabs/comparison into the session;
`compare_analysis { saved: true }` re-runs against the loaded snapshot.

**Bridged (app running)** — two live windows:

```text
open_project_window { path: "/abs/reference.heyl" }   # → { label, path, reused }
list_projects                                          # wait until that label is ready
compare_analysis { tool, with: "<label>" }             # live A/B, UI follows
save_project { path }                                  # saves the live tabs + comparison
```

## Data + chart export

- `export_analysis { tool, path?, format: json|csv }` — one analyzer as a JSON provenance
  envelope or wide-matrix CSV (+ `.meta.json` sidecar). Omit `path` to get the `text` back.
- `export_all { dir, formats }` — every open tab (or, headless, an explicit `tools` list).
- `export_chart { tool, path }` — one tab's chart as PNG (app-only).

**Gotchas:** exports capture the current window (set it first); paths must be **absolute**
and parents are **not** created (unlike `save_project`); exports are always full-res — thin
via `run_analysis { maxPoints }` instead.

## Annotations

`create_annotation { time, title, body, tool?, range? }` hangs an annotation off the
timeline (or a tool). The `values` snapshot is captured from the open chart and **may be
stale** — if the values are wrong, create **without `tool`** (or delete + recreate);
`recomputeValues` does not fix it.

## Auditioning (app-only)

`preview { start?, end? }` plays the window (or range) through the core; loops by default;
accepts `speed` (0.25–4) and `loop`. To audition a candidate loop, `set_analysis_window` to
it and `preview`. `preview` **returns immediately** — there is no completion signal, so you
can't tell when one pass ended.

## Gotchas

- **Mutating tools** (`open_tool` / `close_tool` / `set_*` / `create_annotation`)
  read-modify-write shared state. Call them **sequentially**, not in parallel — updates race
  and the last writer wins.
- **`server shut down`** → the bridge died (it does not auto-reconnect). Re-enable the
  `hey-listen` context server in the client. The port may be **ephemeral** (differs from the
  default `47100`); the bridge discovers it automatically.

## What still needs the app

Visual work only: rendered tabs, editor-layout graph editing (`get_graph`/`set_synth_graph`),
live preview/capture, annotations (`create_annotation` & co.), chart-image export, and live
two-window comparison. Everything else is scriptable without a window.
