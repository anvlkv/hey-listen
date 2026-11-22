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
  uses; the UI follows (`open_tool` opens a tab — its optional `position` splits the
  Workbench into a grid — `open_audio_file` replaces the timeline).
- **No app** → falls back to a **core-native headless** server (no window), covering the
  compute subset.

`get_state.server.mode` reports `bridge` or `headless`.

## Tool inventory

`tools/list` always answers. Compute tools work headless and bridged; the rest answer
*"requires the app"* headless.

| Group | Tools | Headless? |
| --- | --- | --- |
| Observe | `get_state`, `list_analyzers`, `get_analyzer`, `list_nodes`, `get_node` | yes |
| Source | `open_audio_file`, `close_source`, `render_synth`, `list_input_devices`, `list_output_devices`, `list_processes` | yes |
| Analyze | `run_analysis`, `set_analysis_window`, `set_view`, `set_shared_params`, `set_tool_options`, `set_filter_graph` | yes |
| Tabs | `open_tool`, `close_tool` | yes — headless they maintain `SETUP.openTools`, which `save_project` writes (no layout: `open_tool.position` is ignored) |
| Project | `save_project`, `open_project`, `new_project` | yes (source + setup + annotations + `openTools`; parents created) |
| Project window | `open_project_window` | app-only (opens/raises a window at a `.heyl`, returns its label) |
| Compare | `compare_analysis`, `list_projects` | `compare_analysis` yes (project **path** headless, live label bridged, or `saved: true`) |
| Export (data) | `export_analysis`, `export_all` | yes (`export_all` headless takes an explicit `tools` list) |
| Graphs | `get_graph`, `set_synth_graph` | `get_graph` yes (reads back as DOT); `set_synth_graph` app-only (editor layout) |
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

## Filter & synth graphs

Author the filter and synth graphs through the one node catalog and the `GraphSpec`/DOT
form — see [`graphs.md`](graphs.md) for the model, the node map and sound design.

- `list_nodes` / `get_node { kind }` — the catalog; `get_node` returns a ready-to-paste DOT
  skeleton (ports, params, defaults). **Never guess a port or a key.**
- `get_graph { graph: filter|synth }` — read the current graph back as DOT.
- `set_filter_graph { graph, enabled: true }` — install the filter (runs upstream of preview
  and every analyzer); `graph` is DOT text, a `graphFile` path, or a `GraphSpec` object, and
  `null` / `enabled: false` clears it.
- `render_synth { graph, seconds }` — render a synth graph to 48 kHz mono and **adopt it as
  the source**; `graph` is the same DOT/path/`GraphSpec` forms (headless) or the editor graph
  (bridged).
- `set_synth_graph { graph }` — app-only: set the synth editor's layout.

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

## Workbench layout: tabs vs a grid (app-only)

`open_tool` adds a **tab** to the main group by default. Pass a `position` to place it —
the way to show several analyzers as a grid instead of stacked tabs:

```text
get_state                            # → workbench.groups: [{ id, tools, activeTool }]
open_tool { tool: "spectrogram" }                                    # a tab (default)
open_tool { tool: "spectrum", position: { direction: "right" } }    # split main group
open_tool { tool: "mfcc", position: { referenceGroup: "spectrogram", direction: "below" } }
```

- `direction`: `within` (a tab in that group — the default) or `left` / `right` /
  `above` / `below` (split that group and put the tab on that side). Spellings are
  dockview's.
- `referenceGroup`: a group id from `get_state.workbench.groups`, **or** a tool id already
  open in the group (easier). Omitted = the main group. An unknown value **fails**
  (no silent fallback), so read the groups again if a tab was closed.
- `close_tool` merges nothing back: closing the last tab of a group collapses it.
- **App-only.** Headless has no layout: `position` is ignored, only `SETUP.openTools` is
  recorded, and the app opens those tabs in one group. A grid survives a save only when
  the app saved the project (`LAYOUT.dockview`); a headless `save_project` writes no layout.

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
- **Analyzer ids are case-sensitive.** Use exact ids from `list_analyzers` (`framerms` →
  "unknown analyzer").
- **`set_shared_params` can't return a param to "unset"** (e.g. `channel` back to `null`).

## What still needs the app

Visual work only: rendered tabs, Workbench **layout** (`open_tool.position` — the tab
itself is recorded headless, the grid is not), editor-layout graph editing
(`get_graph`/`set_synth_graph`), live preview/capture, annotations (`create_annotation`
& co.), chart-image export, and live two-window comparison. Everything else is scriptable
without a window.
