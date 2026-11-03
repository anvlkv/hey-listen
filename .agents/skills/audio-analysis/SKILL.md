---
name: audio-analysis
description: Drive Hey Listen's audio-analysis engine programmatically — via the built-in MCP server (agent access + live UI following) or the batch CLI (`hey-listen analyze`, headless shell/CI). Covers picking the interface, the discover → run → read workflow, the tool inventory, result modes (summary / compact / full), event segmentation, comparisons, building/opening project files (sources, tabs, saved comparisons), and data/chart export. Use when a task needs to open a source, run analyzers, segment calls/syllables/notes, compare projects, save a project with its tabs/comparison, or read results from an MCP client or a shell.
---

# Driving Hey Listen's analysis engine (MCP + CLI)

Hey Listen exposes one analysis engine (`audio::analysis::run_window`) through two
programmatic interfaces:

1. **MCP server** — an agent drives a *running or headless* project: open sources, run
   tools, edit graphs, preview, compare, save projects. Bridged to the app the UI follows
   along; headless it is the engine + project subset.
2. **Batch CLI** — `hey-listen analyze|compare|project <...>` runs the engine over files
   with no window, printing one JSON object per file/tool. Deterministic; for shell/CI.

Both return the **same envelope** — effective `window` / `params` / `options`, a canonical
`summary`, and a `result` shaped by the requested mode. Authoritative docs:
[`docs/mcp.md`](docs/mcp.md), [`docs/cli.md`](docs/cli.md),
[`docs/analysis-tools.md`](docs/analysis-tools.md), [`docs/comparison.md`](docs/comparison.md).
This skill is the consumer-facing summary. **You should not need the Hey Listen sources:
the MCP tool list + `get_state` + this skill are the surface; the docs above are the
reference.**

## Pick an interface

| Need | Use |
| --- | --- |
| An agent drives the live window, tabs/UI following | MCP **bridge** to the running app |
| An agent analyzes files with nothing open | MCP **headless** (auto-fallback) |
| Build a `.heyl` with a source, setup, filter, tabs, annotations | MCP headless `save_project`, or CLI `project` |
| Compare two projects (file vs file, or app windows) | MCP `compare_analysis` (headless or bridged), or CLI `compare` |
| Save a project **with** its comparison | MCP: `compare_analysis` then `save_project`; CLI: `compare --save` |
| Shell script / CI bulk-analyzes files | **Batch CLI** |
| Read annotations from a saved `.heyl` project | **Batch CLI** `annotations` (list/get) |
| Add / update / delete annotations in a project file | **Batch CLI** `annotations --add/--update/--delete`, or MCP `save_project`'s `annotations` when building |

## The reliable workflow

Discover before you guess, and read the summary before the arrays:

```text
list_analyzers                         # compact catalog: id / title / section / family / keywords
get_analyzer { id }                    # about copy, option ranges, family, decimatable, summary keys
get_state                              # source shape, window, shared params, project, server mode
run_analysis { tool, summaryOnly: true }   # one-line answer first
→ read summary.text; request result only if you need the series
```

- Set the shared window/params once with `set_analysis_window` / `set_shared_params`,
  then per-tool options with `set_tool_options`. Pass overrides inline to `run_analysis`
  instead when you want them for a single call.
- Use `transient: true` on `run_analysis` for independent calls — without it, window and
  option overrides are **written back** and later calls inherit them.
- Pass `display: false` to compute without opening/focusing a tab (default `true`).

## MCP server

### Entry points + configure

Two binaries run the same `mcp::run`, auto-detecting bridge vs headless:

- **App binary with `--mcp`** — preferred on macOS/Linux (works for a bundled app). Never
  opens a window.
- **`heylisten-mcp` helper** — a console binary next to the app
  (`src-tauri/target/{debug,release}/heylisten-mcp`); required on Windows release and on
  GUI-less hosts. `--headless` (with `--mcp`) forces headless, skipping the app probe.

Turn the server on in the Toolbar **MCP** popover (default port `47100`), then use its
**Copy** button:

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

### Bridge vs headless

- **App running + MCP on** → each `tools/call` is forwarded to the **focused project
  window's** frontend and runs through the same stores/commands the UI uses; UI follows
  (`open_tool` opens a tab, `open_audio_file` replaces the timeline, `get_state` reports
  what the window shows).
- **No app** → the same command falls back to a **core-native headless** server over
  stdio (no TCP, no window), covering the engine-backed compute subset.

Every tool accepts an optional `target` (a label from `list_projects`) to address a
specific window instead of the focused one.

### Tools

`tools/list` always answers (static catalog). Compute tools work **headless and bridged**;
the rest answer *"requires the app"* headless.

| Group | Tools | Headless? |
| --- | --- | --- |
| Observe | `get_state`, `list_analyzers`, `get_analyzer` | yes |
| Source | `open_audio_file`, `close_source`, `render_synth`, `list_input_devices`, `list_output_devices`, `list_processes` | yes |
| Analyze | `run_analysis`, `set_analysis_window`, `set_view`, `set_shared_params`, `set_tool_options`, `set_filter_graph` | yes |
| Tabs | `open_tool`, `close_tool` | yes — headless they maintain `SETUP.openTools` (no webview), which `save_project` writes and the app restores |
| Project | `save_project`, `open_project`, `new_project` | yes (source + setup + annotations + `openTools`; parent folders are created) |
| Project window | `open_project_window` | app-only (opens/raises a window at a `.heyl` and returns its label) |
| Compare | `compare_analysis`, `list_projects` | `compare_analysis` yes: a project **path** headless, a live label bridged, or `saved: true`; `list_projects` is answered by the server |
| Export (data) | `export_analysis`, `export_all` | yes (`export_all` headless takes an explicit `tools` list) |
| Graphs | `get_graph`, `set_synth_graph` | app-only (editor layouts) |
| Preview/capture | `preview`, `stop_preview`, `set_output_gain`, `start_capture`, `stop_capture` | app-only |
| Annotations | `list_annotations`, `get_annotation`, `create_annotation`, `update_annotation`, `delete_annotation`, `set_selected_annotation` | app-only (but `save_project` writes the `annotations` you pass headless) |
| Export (chart) | `export_chart` | app-only (needs the rendered canvas) |
| Themes | `list_themes`, `get_theme`, `set_theme`, `import_theme`, `export_theme` | headless lists bundled only |

Templates (M13) are planned and **not yet** exposed as tools.

`compare_analysis` diffs the **same** analyzer on two project sides. Pass `with` — a
project label from `list_projects` when bridged, a **project file path** (`.heyl`) when
headless — or `saved: true` to use the owner's stored reference snapshot. `bOffset`
(seconds) fine-tunes the relative alignment; `includeData` / `maxPoints` / `axis` /
`summaryOnly` shape the side results and the delta exactly like `run_analysis`. B is
read-only. The last successful comparison is stored in the owner, so `save_project`
writes it into `COMPARE` and the app reopens it as a compare tab.
`list_projects` reports each project's `savedComparisons`; headless `get_state` reports
`savedComparisons` and `openTools`. In the app, `open_project_window { path }` opens the
reference as a second window and returns the label to pass as `with`.

## Projects, tabs, and comparisons from a script

A project = source + `SETUP` (window, params, options, `openTools`) + `LAYOUT` (graphs,
filter, popouts) + annotations + saved comparison snapshots. All of it is scriptable; nothing
below opens a window.

**Headless MCP (no app)** — one session, one project:

```text
open_audio_file { path }                 # or render_synth { graph, seconds }
set_analysis_window { start, end }       # optional
transient / params / options              # same overrides as run_analysis
set_filter_graph { graph, enabled: true }# a GraphSpec (no editor headless)
open_tool { tool: "spectrum" }            # repeat; records SETUP.openTools
compare_analysis { tool, with: "/abs/reference.heyl", summaryOnly: true }
                                          # stores the reference snapshot in the session
save_project { path, openTools: [...], annotations: [...], embedSource: true }
                                          # creates parent dirs; writes COMPARE too
get_state                                 # → openTools + savedComparisons + window/params
```

`open_project { path }` loads a project's tabs/comparison into the session, and
`compare_analysis { saved: true }` re-runs against the loaded snapshot. The result opens
in the app with those tabs and a compare tab bound to the saved reference.

**Bridged MCP (app running)** — two live windows:

```text
open_project_window { path: "/abs/reference.heyl" }   # → { label, path, reused }
list_projects                                          # wait until that label is ready
compare_analysis { tool, with: "<label>" }             # live A/B, UI follows
save_project { path }                                  # saves the live tabs + comparison
```

If the project already has a saved comparison and you only want to re-read it, use
`compare_analysis { saved: true }` with one window open.

**CLI (shell, no window)**:

```bash
# Build a project with tabs, annotations and a window:
hey-listen project out.heyl --source call.wav --open-tool noteMetrics \
  --open-tool spectrogram --annotations annotations.json --start 1.2 --end 3.4

# Compare two project files and write the owner with the snapshot:
hey-listen compare a.heyl b.heyl -t spectrum --save a-with-comparison.heyl \
  --open-tool spectrum
```

A comparison is **one per tool**; re-running overwrites that tool's snapshot. Closing the
compare tab (app) and saving drops it.

## Results: summary, compact, full

Every `run_analysis` call (and every CLI `analyze` record) carries:

- **`summary`** — `{ tool, label, text, items }`: a stable one-line `text` plus labelled,
  unit-bearing `items`, computed from the **full** result so it is identical in every mode.
  Read it first — it usually answers the question.
- **`window` / `params` / `options`** — the **effective** settings the call ran with
  (unset option fields omitted, no null padding).
- **`result`** — shaped by mode:

| Mode | MCP | CLI | `result` |
| --- | --- | --- | --- |
| summary | `summaryOnly: true` | `--summary` | omitted |
| compact (default) | no flag | no flag | structural stats |
| full | `includeData: true` | `--full` | raw arrays |

- `summaryOnly` + `includeData` (and `--summary` + `--full`) are **mutually exclusive**.
- Compact is **structural per family**: matrices/spectrograms keep dimensions + peak
  location (`peakTime`/`peakHz`/`peakDb`); numeric series become stats (with `nulls` for
  gaps and `hop` so an index maps to a time); event/note arrays keep counts plus a
  five-record preview. `noteMetrics` also carries **`bounds`** — every detected span — so
  segmenting never needs a full result.
- `maxPoints: N` thins a full result to ≤ N points, **family-aware** (time axes move
  together, matrices thin by whole frames). It never removes events from
  `noteMetrics`/`onsets` lists. Check `decimatable` from `get_analyzer` before relying on it.
- `axis: "compact"` replaces a `times` array with `{ start, hop, length, end }` (an
  overlap-add edge frame as `firstHop`/`lastHop`). Use when a full result is needed but
  the repeated time grid is not.

**Discovery.** `list_analyzers` is the catalog; `get_analyzer { id }` gives `about` copy,
option metadata (`key/label/default/min/max/step/unit/help`), `family`, `decimatable`, and
`summaryKeys`. The CLI's `analyzers [ID] [--json]` mirrors both. Unknown option keys are
**errors** (canonical camelCase; snake_case aliases accepted).

## Finding events (calls, syllables, notes)

Use the **gated segmenter + fine envelope**, not flux peaks:

```text
frameRms     # ~10 ms frame / 5 ms hop, linear envelope in dBFS
noteMetrics  # gate + hysteresis + min note/gap; spans, levels, f0, voice quality
```

- `noteMetrics` compact returns `bounds` for every event; then run per-event analyzers
  (`spectrum`, `pitchPyin`, `modulation`, …) over each span.
- `syllableGapMs` on `noteMetrics` also yields `syllables` (adjacent notes merged across a
  short gap). Amplitude belongs to the syllable, not the note.
- Gate a scalar series with `gateDb` (0 = off) to exclude pre-roll/background instead of
  post-filtering `frameRms`. Works on `frameRms`, `spectralCentroid`, `spectralRolloff`,
  `spectralFlatness`, `zeroCrossingRate`, `harmonicRatio`.
- Trust pitch medians only when `voicedFrames ≥ 8` (`f0Reliable: 1`), an FM rate only when
  `fmReliable: 1`. `harmonicRatio` is **max autocorrelation, not HNR in dB**; use
  `spectralFlatness` for noisiness.
- `onsets` and `spectralFlux` are **ungated** — a cross-check, not a segmenter.
- `loudnessMomentary` is a 400 ms EBU R128 block; it smears short calls.
- Set `minF0Hz`/`maxF0Hz` per corpus. The defaults are per tool (YIN 50–2000,
  autocorrelation 60–1200, harmonic ratio 50–4000, `noteMetrics` 50–2000) — a 75 Hz
  penguin or ~3 kHz swift needs an explicit range.

`list_annotations` returns compact summaries by default; pass `full: true` (or `get_annotation`) for
the full markdown body and frozen values snapshot.

## Batch CLI

A subcommand of the app binary, run in `setup` before any window exists, then print and
exit. `--help` / `--version` come free.

```text
hey-listen [OPTIONS] [FILE.heyl]
hey-listen <COMMAND>

Commands:
  analyzers [ID] [--json]   catalog, or one analyzer's options + summary keys
  analyze                   decode file(s) and run analyzer(s) over them
  synth                     render a synth graph, then (optionally) analyze it
  annotations               list or edit annotations in a project file (.heyl)
  compare A.heyl B.heyl     diff one analyzer across two saved projects (--save writes it)
  project OUT.heyl          build a project from a source + setup + tabs, no window

Options:
  -m, --mcp      run the stdio MCP entry instead of the GUI
      --headless (with --mcp) force the core-native headless MCP server
```

### `analyze <FILE>...`

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id; repeatable; required unless `--all`. |
| `--all` | Run every analyzer. |
| `--start <SEC>` / `--end <SEC>` | Window (default `0` / full duration). |
| `--windows <FILE>` | Many windows in one process: one `start,end[,tool…]` per line (`#` comments). A line without tools uses `-t`/`--all`. Not with `--start`/`--end`. |
| `-p, --param <K=V>` | Patch a **shared** param (repeatable): `fftSize`, `hop` (fraction of `fftSize`; `0.25` = 75% overlap), `windowFn`, `channel`, `resampleTo`, `freqMinHz`, `freqMaxHz`, `randomizedOverlap`. |
| `-o, --option [TOOL.]K=V` | Patch a **per-tool** option (repeatable). Name the tool with several (`-o mfcc.nMfcc=13`); bare `-o K=V` scopes to the sole `--tool`. **Run `analyzers <ID>` for exact keys/defaults/ranges.** |
| `--filter <FILE>` | Apply a filter `GraphSpec` (JSON) before analysis. |
| `--summary` / `--full` | Summary only / raw arrays (default: compacted). Mutually exclusive. |
| `--pretty` | Pretty-print a single result instead of JSONL. |
| `--fail-fast` | Stop at the first failure (default: run the whole batch). |
| `--format <json\|csv>` / `--csv` / `--out <FILE\|DIR>` | Data export: JSON provenance envelope or wide-matrix CSV (+ `.meta.json` sidecar); write to file/dir instead of stdout. |

**Scale:** many **files** → batch CLI (one process, JSONL). Many **windows in one file** →
`analyze --windows FILE` or one headless MCP session (1k windows ≠ 1k process startups).

### `compare <A.heyl> <B.heyl>`

Diff **the same analyzer** across two saved projects, each using its own saved window,
shared params, tool options and filter. Matching is **relative** (each side starts at 0);
`--overlap` opts into the old absolute-intersection rule.

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id; repeatable, one line per tool. Required unless `--all`. |
| `--all` | Every analyzer. |
| `--start` / `--end` | Override both sides' windows. |
| `--a-start` / `--a-end` / `--b-start` / `--b-end` | Override one side's window. |
| `--b-offset <SECS>` | Move side B on the relative axis (positive = later; default `0`). |
| `--overlap` | Clip both sides to their absolute-time intersection. |
| `-p` / `-o` / `--filter` | Patch params/options, or override saved filters, on both sides. |
| `--full` / `--summary` | Delta arrays, or summaries + diff stats only. |
| `--save <OUT.heyl>` | Write owner A with the reference snapshots (the app reopens it as a compare tab). |
| `--open-tool <ID>` | With `--save`, override the saved project's tabs (repeatable). |

Each line is `{ tool, a, b, comparability, diff }`; `diff` is absent when the grids differ
(`comparability.mismatches` says why). Project files only — `analyze` covers raw audio.
`--save` stores the diff's effective setup in the owner, so reopening reproduces it;
the saved path goes to stderr.

### `project <OUT.heyl>`

Build a project file with no window — the CLI face of the headless
`open_audio_file`/`render_synth` → `set_*` → `open_tool` → `save_project` sequence.

| Option | Meaning |
| --- | --- |
| `--source <AUDIO>` / `--synth <GRAPH.json>` | The source (exactly one). `--seconds` sets a synth's length (default 5). |
| `--name <NAME>` | Display name (default: the output file stem). |
| `--open-tool <ID>` | Analyzer tab to restore (repeatable). |
| `--annotations <FILE.json>` | Annotations: a JSON array of annotation objects (`title`, `body`, `timeSecs`, optional `range`/`tool`). |
| `--start` / `--end` | Analysis window (default 0 … full duration). |
| `-p` / `-o` / `--filter` | Shared params, per-tool options (`-o mfcc.nMfcc=13`), and a filter `GraphSpec` saved into the project. |
| `--reference` | Keep only the file `SOURCE` path (no embedded audio). |

One JSON line: `{ path, name, embedded, annotations, openTools }`; parent folders are created.

### `annotations <FILE.heyl>`

List or edit a project's annotations, no window: `--json` / `--full` list, `--get <ID>`,
`--add <FILE.json>` (an array of annotation objects), `--update <ID> --set FIELD=VALUE`
(`title`, `body`, `timeSecs`/`time`/`at`, `range=start,end` or `none`, `tool=id` or
`none`), `--delete <ID>`. Mutations rewrite the project atomically; `--to <COPY.heyl>`
edits a copy. An open app does not watch the file — reload after editing. (The MCP annotation
tools operate on the live project and stay app-only; headless, pass `annotations` to
`save_project` when building, or use this CLI.)

```bash
hey-listen annotations mix.heyl --add annotations.json
hey-listen annotations mix.heyl --update n1 --set title="Third harmonic" --set range=2.5,2.9
hey-listen annotations mix.heyl --get n1
hey-listen annotations mix.heyl --delete n1
```

### Output, exit codes, examples

**JSONL by default** — one self-describing object per line, streamable with `jq`. Logs go
to **stderr**, so stdout is pure JSONL.

| Exit | Meaning |
| --- | --- |
| `0` | Every file/tool succeeded. |
| `1` | At least one file/tool failed (failing line carries `error`). |
| `2` | Usage error (unknown subcommand/flag, bad `K=V`, missing `-t`). |

```bash
# One number per file:
hey-listen analyze *.wav -t loudnessIntegrated | jq -c '{file, lufs: .result.lufs}'

# Sweep with summaries only:
hey-listen analyze *.wav -t levels --summary | jq -c '{file, summary: .summary.text}'

# 4 s window at 10 s, big FFT, two tools:
hey-listen analyze a.wav -t spectrum -p fftSize=8192 -t tempo --start 10 --end 14

# Many windows in one file, one process:
hey-listen analyze call.wav -t noteMetrics --windows windows.txt > call.jsonl

# Gate a series to drop the recording's background:
hey-listen analyze call.wav -t spectralCentroid -o spectralCentroid.gateDb=20 --full

# Discover ids, then explain one analyzer:
hey-listen analyzers --json | jq -r '.[].id'
hey-listen analyzers noteMetrics

# Diff two saved projects:
hey-listen compare before.heyl after.heyl -t spectrum --summary
```

## What still needs the app

Bridged MCP is needed for **visual** work: Workbench tabs that render, editor-layout graph
editing (`get_graph` / `set_synth_graph`), live preview/capture, annotations
(`create_annotation` & co.), chart-image export, and a live two-window comparison. Everything
else is scriptable without a window: sources, analysis, filters, project files **with
their tabs and comparisons** (`save_project` + `open_tool`, or CLI `project`), and
headless comparisons against a project file (`compare_analysis { with: path }`, or CLI
`compare`). The CLI never bridges to a running app, and `open_project_window` is the one
app-only tool that deliberately creates a window (for a scripted app-side A/B).
